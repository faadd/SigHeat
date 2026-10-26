"""Shared-v2 numeric processing for the Termux acquisition path (SI units)."""
from collections import deque
import math
import statistics
import threading
import time

GRAVITY = 9.80665


def number(value, low=-math.inf, high=math.inf):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value) if math.isfinite(value) and low <= value <= high else None
    except (ValueError, OverflowError):
        return None


def vector(values, limit=1000):
    if not isinstance(values, (tuple, list)) or len(values) < 3:
        return None
    xyz = tuple(number(value, -limit, limit) for value in values[:3])
    return xyz if all(value is not None for value in xyz) else None


class MotionWindow:
    """Streaming statistics: bounded memory, explicit gaps and real arrival times."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.last_accel_at = self.last_gyro_at = None
        self._reset(clock())

    def _reset(self, now):
        self.started = now
        self.accel_count = self.gyro_count = 0
        self.accel_sum = self.gyro_sum = self.rotation = self.covered = 0.0
        self.last_gyro = None
        self.pairs = 0
        self.gap = False

    def add_acceleration(self, values, timestamp=None):
        xyz = vector(values)
        if xyz is None:
            return False
        now = self.clock() if timestamp is None else timestamp
        residual = math.sqrt(sum(v * v for v in xyz)) - GRAVITY
        with self.lock:
            self.accel_sum += residual * residual
            self.accel_count += 1
            self.last_accel_at = now
        return True

    def add_gyroscope(self, values, timestamp=None):
        xyz = vector(values)
        if xyz is None:
            return False
        now = self.clock() if timestamp is None else timestamp
        # Android Sensor.TYPE_GYROSCOPE reports rad/s; do NOT convert degrees here.
        omega = math.sqrt(sum(v * v for v in xyz))
        with self.lock:
            self.gyro_sum += omega * omega
            self.gyro_count += 1
            if self.last_gyro is not None:
                previous_at, previous_omega = self.last_gyro
                dt = now - previous_at
                if 0 < dt <= .5:
                    self.rotation += (previous_omega + omega) * .5 * dt
                    self.covered += dt
                    self.pairs += 1
                elif dt > .5:
                    self.gap = True
            self.last_gyro = (now, omega)
            self.last_gyro_at = now
        return True

    def counts(self):
        with self.lock:
            return self.accel_count, self.gyro_count

    def snapshot(self, timestamp=None):
        now = self.clock() if timestamp is None else timestamp
        with self.lock:
            a = self.accel_count if self.last_accel_at is not None and now - self.last_accel_at <= 5 else 0
            g = self.gyro_count if self.last_gyro_at is not None and now - self.last_gyro_at <= 5 else 0
            errors = []
            if not a:
                errors.append('accelerometer_missing_or_stale')
            if not g:
                errors.append('gyroscope_missing_or_stale')
            if self.gap:
                errors.append('gyroscope_event_gap')
            result = {
                'accel_rms': round(math.sqrt(self.accel_sum / a), 4) if a else None,
                'accel_mode': 'gravity_removed' if a else 'unavailable',
                'accel_available': bool(a), 'accel_samples': a,
                'gyro_rms_rad_s': round(math.sqrt(self.gyro_sum / g), 4) if g else None,
                'gyro_available': bool(g), 'gyro_samples': g,
                'rotation_total_rad': round(self.rotation, 4) if g and self.pairs else None,
                'gyro_covered_ms': round(self.covered * 1000, 2) if g and self.pairs else None,
                'sensor_window_ms': round(max(0, now - self.started) * 1000, 2),
                'sensor_errors': errors,
            }
            self._reset(now)
            return result


class ProbeWindow:
    def __init__(self):
        self.attempts = deque(maxlen=10)

    def add(self, latency_ms):
        latency = number(latency_ms, 0, 60000)
        self.attempts.append(latency)
        success = [value for value in self.attempts if value is not None]
        return {
            'latency_ms': round(latency, 2) if latency is not None else None,
            'latency_mean_ms': round(statistics.mean(success), 2) if success else None,
            'latency_std_ms': round(statistics.pstdev(success), 2) if len(success) >= 2 else None,
            'success_pct': round(len(success) / len(self.attempts) * 100, 1),
            'probe_count': len(self.attempts), 'probe_ok': latency is not None,
        }
