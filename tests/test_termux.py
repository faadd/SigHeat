import contextlib
import io
import json
import math
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from termux_edge import Config, TermuxEdge, canonical_endpoint, validate_command, main
from termux_sensors import discover_sensors, TermuxSensors, JSONStream, stop_process
from termux_processing import GRAVITY, MotionWindow, ProbeWindow


class EndpointAndCommandTests(unittest.TestCase):
    def test_wss_canonicalization(self):
        self.assertEqual(canonical_endpoint('wss://EXAMPLE.COM:443'), 'wss://example.com/')
        self.assertEqual(canonical_endpoint('wss://EXAMPLE.COM:8884/mqtt'), 'wss://example.com:8884/mqtt')
        for value in ('ws://example.com/mqtt', 'wss://user:pass@example.com/mqtt', 'wss://example.com:0/mqtt',
                      'wss://example.com/mqtt?secret=1', 'wss://example.com/mqtt#x', 'wss://example.com/a/../mqtt',
                      'wss://example.com/%2e%2e/mqtt', 'wss://example.com/a\\b'):
            with self.assertRaises(ValueError, msg=value):
                canonical_endpoint(value)

    def test_command_target_ttl_rate_fields_and_numeric_safety(self):
        command = {'command_id': 'cmd1', 'device_id': 'hp-a', 'target_boot_id': 'boot-one', 'action': 'set_interval',
                   'interval_s': 5, 'sent_at_ms': 100000, 'expires_at_ms': 115000}
        encoded = json.dumps(command)
        self.assertIsNotNone(validate_command(encoded, 'hp-a', 'boot-one', 100000))
        self.assertIsNone(validate_command(encoded, 'hp-a', 'boot-two', 100000))
        self.assertIsNone(validate_command(encoded, 'hp-a', 'boot-one', 100000, retained=True))
        for change in ({'interval_s': True}, {'interval_s': '5'}, {'interval_s': 61}, {'expires_at_ms': 140000},
                       {'sent_at_ms': 10**1000}, {'action': 'shell'}, {'device_id': 'hp-b'}):
            self.assertIsNone(validate_command(json.dumps({**command, **change}), 'hp-a', 'boot-one', 100000))
        self.assertIsNone(validate_command('['*1100 + ']'*1100, 'hp-a', 'boot-one', 100000))


class SensorSelectionTests(unittest.TestCase):
    def test_default_avoids_linear_acceleration_and_uncalibrated(self):
        names = ['Linear Acceleration', 'Accelerometer Uncalibrated', 'BMI Accelerometer', 'Gyroscope Uncalibrated', 'BMI Gyroscope']
        with patch('termux_sensors.shutil.which', return_value='/tool'), patch('termux_sensors.subprocess.run') as run:
            run.return_value.stdout = json.dumps({'sensors': names})
            self.assertEqual(discover_sensors(), ('BMI Accelerometer', 'BMI Gyroscope'))
            self.assertEqual(discover_sensors('BMI Accelerometer', 'BMI Gyroscope'), ('BMI Accelerometer', 'BMI Gyroscope'))
            self.assertNotIn('shell', run.call_args.kwargs)
            for wrong in ('Linear Acceleration', 'Accelerometer Uncalibrated', 'Gravity'):
                with self.assertRaisesRegex(RuntimeError, 'accelerometer mentah'):
                    discover_sensors(wrong, 'BMI Gyroscope')

    def test_check_sensors_is_offline_and_accepts_explicit_names(self):
        sensors = MagicMock()
        sensors.processing.counts.return_value = (2, 2)
        sensors.snapshot.return_value = {'accel_available': True, 'gyro_available': True, 'rotation_total_rad': .1}
        with patch('termux_edge.discover_sensors', return_value=('Raw accel', 'Raw gyro')) as discover, \
             patch('termux_edge.TermuxSensors', return_value=sensors), patch('termux_edge.TermuxEdge') as edge, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(['--check-sensors', '--accelerometer', 'Raw accel', '--gyroscope', 'Raw gyro']), 0)
        discover.assert_called_once_with('Raw accel', 'Raw gyro')
        edge.assert_not_called()
        sensors.stop.assert_called_once()

    def test_process_stop_escalates_and_reaps(self):
        import subprocess
        process = MagicMock(pid=12345)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('sensor', 2), 0]
        with patch('termux_sensors.os.killpg') as kill:
            stop_process(process)
        self.assertEqual(kill.call_count, 2)
        self.assertEqual(process.wait.call_count, 2)


class StatisticsTests(unittest.TestCase):
    def test_ten_attempt_window_preserves_failures_without_fake_latency(self):
        window = ProbeWindow()
        first = window.add(100)
        self.assertIsNone(first['latency_std_ms'])
        second = window.add(None)
        self.assertEqual(second['latency_mean_ms'], 100)
        self.assertEqual(second['success_pct'], 50)
        for _ in range(10):
            result = window.add(None)
        self.assertEqual(result['probe_count'], 10)
        self.assertIsNone(result['latency_mean_ms'])
        self.assertIsNone(result['latency_std_ms'])
        self.assertFalse(result['probe_ok'])

    def test_one_gyro_sample_cannot_claim_integrated_rotation(self):
        window = MotionWindow(clock=lambda: 0)
        window.add_gyroscope([0, 0, math.pi], 0)
        result = window.snapshot(.1)
        self.assertTrue(result['gyro_available'])
        self.assertIsNone(result['rotation_total_rad'])
        self.assertIsNone(result['gyro_covered_ms'])


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.now = 10.0
        self.clock = lambda: self.now
        self.sensors = MagicMock()
        window = MotionWindow(clock=self.clock)
        window.add_acceleration([0, 0, GRAVITY + 1])
        window.add_gyroscope([0, 0, math.pi])
        self.now += .1
        window.add_acceleration([0, 0, GRAVITY + 1])
        window.add_gyroscope([0, 0, math.pi])
        self.sensors.snapshot.side_effect = lambda: {**window.snapshot(), 'latitude': None, 'longitude': None, 'accuracy_m': None, 'location_at_ms': None}
        self.client = MagicMock()
        self.client.is_connected.return_value = True
        self.client.subscribe.return_value = (0, 7)
        self.client.publish.return_value = SimpleNamespace(rc=0)
        self.mqtt = SimpleNamespace(Client=MagicMock(return_value=self.client), CallbackAPIVersion=SimpleNamespace(VERSION2=2), MQTTv311=4)
        self.edge = TermuxEdge(Config('hp-a', 'team1'), self.sensors, self.mqtt, self.clock, lambda: 1800000000 + self.now, lambda text: None)
        self.edge.connect()

    def ready(self):
        self.edge.on_connect(self.client, None, None, SimpleNamespace(is_failure=False), None)
        self.edge.on_subscribe(self.client, None, 7, [SimpleNamespace(is_failure=False)]*2, None)

    def test_wss_verified_tls_and_ready_only_after_two_subacks(self):
        self.assertEqual(self.mqtt.Client.call_args.kwargs['transport'], 'websockets')
        self.client.ws_set_options.assert_called_once_with(path='/mqtt')
        self.client.tls_set.assert_called_once_with()
        self.client.tls_insecure_set.assert_not_called()
        self.edge.on_connect(self.client, None, None, SimpleNamespace(is_failure=False), None)
        self.assertFalse(self.edge.ready.is_set())
        self.edge.on_subscribe(self.client, None, 7, [SimpleNamespace(is_failure=False)]*2, None)
        self.assertTrue(self.edge.ready.is_set())

    def test_failed_suback_never_ready(self):
        self.edge.on_connect(self.client, None, None, SimpleNamespace(is_failure=False), None)
        self.edge.on_subscribe(self.client, None, 7, [SimpleNamespace(is_failure=False), SimpleNamespace(is_failure=True)], None)
        self.assertFalse(self.edge.ready.is_set())
        self.assertTrue(self.edge.stopped.is_set())

    def test_measured_nonce_echo_and_shared_v2_payload(self):
        self.ready()
        def publish(topic, raw, **kwargs):
            if topic == self.edge.probe_topic:
                self.now += .025
                self.edge.on_message(self.client, None, SimpleNamespace(topic=topic, payload=raw.encode(), retain=False))
            return SimpleNamespace(rc=0)
        self.client.publish.side_effect = publish
        latency = self.edge.measure_probe(timeout=.1)
        self.assertAlmostEqual(latency, 25)
        payload = self.edge.make_payload(latency)
        self.assertEqual(payload['schema_version'], 2)
        self.assertEqual(payload['source'], 'termux')
        self.assertEqual(payload['latency_type'], 'mqtt_app_rtt')
        self.assertTrue(payload['probe_ok'])
        self.assertEqual(payload['accel_rms'], 1)
        self.assertAlmostEqual(payload['gyro_rms_rad_s'], math.pi, places=4)
        self.assertAlmostEqual(payload['rotation_total_rad'], math.pi * .1, places=4)
        self.assertNotIn('rssi_dbm', payload)

    def test_commands_reject_old_boot_retained_and_replay_without_side_effect(self):
        self.ready()
        command = {'command_id': 'cmd1', 'device_id': 'hp-a', 'target_boot_id': self.edge.boot_id, 'action': 'set_interval',
                   'interval_s': 8, 'sent_at_ms': self.edge.timestamp(), 'expires_at_ms': self.edge.timestamp()+15000}
        def send(data, retained=False):
            self.edge.on_message(self.client, None, SimpleNamespace(topic=self.edge.base+'/command', payload=json.dumps(data).encode(), retain=retained))
        send({**command, 'target_boot_id': 'boot-old'})
        send(command, True)
        self.assertEqual(self.edge.config.interval_s, 5)
        send(command)
        self.assertEqual(self.edge.config.interval_s, 8)
        send({**command, 'interval_s': 10})
        self.assertEqual(self.edge.config.interval_s, 8)
        acks = [json.loads(call.args[1]) for call in self.client.publish.call_args_list if call.args[0].endswith('/ack')]
        self.assertEqual(len(acks), 2)
        self.assertEqual(acks[0], acks[1])


if __name__ == '__main__':
    unittest.main()
