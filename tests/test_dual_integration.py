"""Independent tests for the optional Termux path and public-server boundary."""
import importlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import ssl
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from types import SimpleNamespace

import server
from termux_processing import GRAVITY, MotionWindow, ProbeWindow
from termux_sensors import JSONStream, TermuxSensors, stop_process
from termux_edge import Config, TermuxEdge


class TermuxAcquisitionContractTests(unittest.TestCase):
    def test_partial_pretty_json_updates_each_sensor_once_and_preserves_rad_per_second(self):
        frames = [
            {'Accel é': {'values': [0, 0, GRAVITY + 1]}},
            {'Gyro': {'values': [0, 0, math.pi]}},
            {'Gyro': {'values': [0, 0, math.pi]}},
        ]
        wire = '\n'.join(json.dumps(frame, indent=2, ensure_ascii=False) for frame in frames).encode('utf-8')
        decoder = JSONStream()
        decoded = []
        for position in range(0, len(wire), 3):
            decoded.extend(decoder.feed(wire[position:position + 3]))
        self.assertEqual(decoded, frames)
        sensors = TermuxSensors('Accel é', 'Gyro', clock=lambda: .4)
        for frame, timestamp in zip(decoded, [0, .1, .3]):
            sensors.consume(frame, timestamp)
        result = sensors.snapshot()
        self.assertEqual(result['accel_samples'], 1)
        self.assertEqual(result['gyro_samples'], 2)
        self.assertAlmostEqual(result['accel_rms'], 1, places=4)
        self.assertAlmostEqual(result['gyro_rms_rad_s'], math.pi, places=4)
        self.assertAlmostEqual(result['rotation_total_rad'], math.pi * .2, places=4)
        self.assertEqual(result['gyro_covered_ms'], 200)

    def test_independent_freshness_and_unknowns_do_not_reuse_other_sensor(self):
        now = [0.]
        sensors = TermuxSensors('Accel', 'Gyro', clock=lambda: now[0])
        sensors.consume({'Accel': {'values': [0, 0, GRAVITY]}})
        now[0] = 6
        sensors.consume({'Gyro': {'values': [0, 0, 1]}})
        result = sensors.snapshot()
        self.assertIsNone(result['accel_rms'])
        self.assertFalse(result['accel_available'])
        self.assertEqual(result['gyro_rms_rad_s'], 1)
        self.assertEqual(result['gyro_samples'], 1)
        self.assertIsNone(result['rotation_total_rad'])
        self.assertIn('accelerometer_missing_or_stale', result['sensor_errors'])

    def test_equal_arrival_times_and_large_gaps_are_not_integrated_as_measured_rotation(self):
        for timestamps in [(0, 0), (0, 1)]:
            with self.subTest(timestamps=timestamps):
                window = MotionWindow(clock=lambda: 0)
                for timestamp in timestamps:
                    window.add_gyroscope([0, 0, 2], timestamp)
                result = window.snapshot(timestamps[-1] + .01)
                self.assertIsNone(result['rotation_total_rad'])
                self.assertIsNone(result['gyro_covered_ms'])

    def test_streaming_statistics_keep_all_measurements_beyond_a_thousand(self):
        window = MotionWindow(clock=lambda: 0)
        for i in range(1200):
            window.add_acceleration([0, 0, GRAVITY + (10 if i < 100 else 0)], i / 100)
        result = window.snapshot(12)
        self.assertEqual(result['accel_samples'], 1200)
        self.assertAlmostEqual(result['accel_rms'], math.sqrt(100 * 100 / 1200), places=4)

    def test_invalid_sensor_values_and_failed_probes_remain_null(self):
        window = MotionWindow(clock=lambda: 0)
        for values in [None, [None, 0, 0], [math.nan, 0, 0], [math.inf, 0, 0], [True, 0, 0]]:
            self.assertFalse(window.add_acceleration(values))
            self.assertFalse(window.add_gyroscope(values))
        result = window.snapshot(1)
        self.assertIsNone(result['accel_rms'])
        self.assertIsNone(result['gyro_rms_rad_s'])
        probe = ProbeWindow().add(None)
        self.assertIsNone(probe['latency_ms'])
        self.assertIsNone(probe['latency_mean_ms'])
        self.assertFalse(probe['probe_ok'])
        self.assertEqual(probe['success_pct'], 0)

    def test_stream_is_bounded_and_invalid_utf8_does_not_become_sensor_data(self):
        with self.assertRaises(ValueError):
            JSONStream(maximum=32).feed(b'{' + b' ' * 33)
        with self.assertRaises(UnicodeDecodeError):
            JSONStream().feed(b'\xff')


class TermuxRuntimeBoundaryTests(unittest.TestCase):
    def test_real_paho_client_keeps_certificate_and_hostname_verification(self):
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            self.skipTest('Install requirements.txt to inspect the Paho TLS context')
        sensors = SimpleNamespace(stop=lambda: None)
        edge = TermuxEdge(Config('py-a', 'integration', 'wss://example.test:443/mqtt'), sensors, mqtt_module=mqtt)
        with patch.object(mqtt.Client, 'connect_async') as connect, patch.object(mqtt.Client, 'loop_start'):
            edge.connect()
        self.assertEqual(edge.client._ssl_context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(edge.client._ssl_context.check_hostname)
        self.assertEqual(connect.call_args.args[:2], ('example.test', 443))
        edge.stop()

    def test_only_first_nonce_echo_is_measured_and_retained_echo_is_ignored(self):
        clock = [1.]
        edge = TermuxEdge(Config('py-a', 'integration'), SimpleNamespace(), clock=lambda: clock[0])
        edge.pending = {'nonce': 'nonce-one', 'started': 1., 'deadline': 6., 'latency': None}
        message = SimpleNamespace(topic=edge.probe_topic, payload=json.dumps({'nonce': 'nonce-one', 'boot_id': edge.boot_id}).encode(), retain=True)
        clock[0] = 1.025
        edge.on_message(None, None, message)
        self.assertIsNone(edge.pending['latency'])
        message.retain = False
        edge.on_message(None, None, message)
        first = edge.pending['latency']
        clock[0] = 1.080
        edge.on_message(None, None, message)
        self.assertAlmostEqual(first, 25)
        self.assertEqual(edge.pending['latency'], first)

    def test_sensor_cleanup_occurs_even_when_client_disconnect_raises(self):
        stopped = []
        edge = TermuxEdge(Config('py-a', 'integration'), SimpleNamespace(stop=lambda: stopped.append(True)))
        def fail():
            raise RuntimeError('mock disconnect failure')
        edge.client = SimpleNamespace(is_connected=lambda: False, disconnect=fail, loop_stop=lambda: None)
        with self.assertRaises(RuntimeError):
            edge.stop()
        self.assertEqual(stopped, [True])

    @unittest.skipUnless(hasattr(__import__('os'), 'killpg'), 'POSIX process groups required')
    def test_owned_sensor_process_is_terminated_and_reaped(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], stdout=subprocess.PIPE, start_new_session=True)
        try:
            stop_process(process)
            self.assertIsNotNone(process.poll())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            process.stdout.close()


class DualServerBoundaryTests(unittest.TestCase):
    def test_new_python_and_actual_private_configuration_are_not_downloadable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'index.html').write_text('<title>SigHeat</title>')
            for filename in ['termux_edge.py', 'termux_sensors.py', '.env', 'requirements.txt']:
                (root / filename).write_text('private-fixture-content')
            with patch.object(server, 'ROOT', root):
                http = ThreadingHTTPServer(('127.0.0.1', 0), server.PublicHandler)
                thread = threading.Thread(target=http.serve_forever, daemon=True)
                thread.start()
                try:
                    for filename in ['termux_edge.py', 'termux_sensors.py', '.env', 'requirements.txt']:
                        with self.subTest(filename=filename), self.assertRaises(urllib.error.HTTPError) as cm:
                            urllib.request.urlopen(f'http://127.0.0.1:{http.server_port}/{filename}')
                        self.assertEqual(cm.exception.code, 404)
                finally:
                    http.shutdown()
                    http.server_close()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
