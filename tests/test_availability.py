"""Deterministic transport simulation; not a physical Android/network test."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock
from termux_edge import Config, TermuxEdge


class TermuxReconnectTests(unittest.TestCase):
    def setUp(self):
        self.clock_value = 100.0
        self.sensors = MagicMock()
        self.client = MagicMock()
        self.client.is_connected.return_value = True
        self.client.subscribe.return_value = (0, 7)
        self.client.publish.return_value = SimpleNamespace(rc=0)
        self.mqtt = SimpleNamespace(Client=MagicMock(return_value=self.client),
                                    CallbackAPIVersion=SimpleNamespace(VERSION2=2), MQTTv311=4)
        self.logs = []
        self.edge = TermuxEdge(Config('hp-a', 'team1'), self.sensors, self.mqtt,
                               clock=lambda: self.clock_value, logger=self.logs.append)
        self.edge.connect()

    def ready(self):
        self.edge.on_connect(self.client, None, None, SimpleNamespace(is_failure=False), None)
        self.edge.on_subscribe(self.client, None, 7, [SimpleNamespace(is_failure=False)] * 2, None)

    def test_auto_reconnect_delay_and_initial_network_failure_are_recoverable(self):
        self.assertTrue(self.mqtt.Client.call_args.kwargs['reconnect_on_failure'])
        self.client.reconnect_delay_set.assert_called_once_with(min_delay=1, max_delay=30)
        self.client.on_connect_fail(self.client, None)
        self.assertFalse(self.edge.ready.is_set())
        self.assertFalse(self.edge.stopped.is_set())
        self.ready()
        self.assertTrue(self.edge.ready.is_set())

    def test_disconnect_invalidates_probe_and_inserts_gap_without_fake_measurement(self):
        self.ready()
        old_boot = self.edge.boot_id
        self.edge.sequence = 12
        self.edge.pending = {'nonce': 'abc', 'latency': 5, 'started': 100, 'deadline': 105}
        self.edge.on_disconnect(self.client, None, None, None, None)
        self.assertFalse(self.edge.ready.is_set())
        self.assertFalse(self.edge.stopped.is_set())
        self.assertIsNone(self.edge.pending)
        self.assertTrue(self.edge.probe_event.is_set())
        self.assertEqual(self.edge.sequence, 13)
        self.assertEqual(self.edge.boot_id, old_boot)
        self.assertTrue(all(not call.args[0].endswith('/telemetry') for call in self.client.publish.call_args_list))
        self.edge.on_disconnect(self.client, None, None, None, None)
        self.assertEqual(self.edge.sequence, 13)  # Repeated disconnect is not a sample.
        self.edge.on_subscribe(self.client, None, 7, [SimpleNamespace(is_failure=False)] * 2, None)
        self.assertFalse(self.edge.ready.is_set())  # An old SUBACK cannot revive it.
        self.edge.probes.add(999)
        self.ready()
        self.assertTrue(self.edge.ready.is_set())
        self.assertEqual(self.edge.probes.add(10)['probe_count'], 1)
        self.sensors.snapshot.assert_called_once()

    def test_loss_during_probe_cannot_return_stale_success(self):
        self.ready()
        def drop(*args, **kwargs):
            self.edge.on_disconnect(self.client, None, None, None, None)
            return SimpleNamespace(rc=0)
        self.client.publish.side_effect = drop
        self.assertIsNone(self.edge.measure_probe(timeout=.01))
        self.assertFalse(self.edge.ready.is_set())
        self.assertIsNone(self.edge.pending)

    def test_stop_is_terminal_even_if_late_connect_callback_arrives(self):
        self.ready()
        self.edge.stop()
        self.edge.on_connect(self.client, None, None, SimpleNamespace(is_failure=False), None)
        self.edge.on_disconnect(self.client, None, None, None, None)
        self.assertTrue(self.edge.stopped.is_set())
        self.assertFalse(self.edge.ready.is_set())
        self.client.loop_stop.assert_called_once()
        self.sensors.stop.assert_called_once()


if __name__ == '__main__':
    unittest.main()
