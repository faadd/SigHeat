"""Termux:API acquisition. Continuous JSON stream; no fabricated sensor fallback."""
import codecs
import json
import os
import selectors
import shutil
import signal
import subprocess
import threading
import time
from termux_processing import MotionWindow, number


class JSONStream:
    """Decode pretty printed/concatenated JSON objects across arbitrary byte chunks."""
    def __init__(self, maximum=65536):
        self.buffer = ''
        self.maximum = maximum
        self.decoder = json.JSONDecoder()
        self.utf8 = codecs.getincrementaldecoder('utf-8')()

    def feed(self, chunk):
        self.buffer += self.utf8.decode(chunk) if isinstance(chunk, bytes) else chunk
        if len(self.buffer) > self.maximum:
            raise ValueError('Sensor output exceeds bounded JSON buffer')
        objects = []
        while self.buffer.strip():
            self.buffer = self.buffer.lstrip()
            try:
                value, offset = self.decoder.raw_decode(self.buffer)
            except json.JSONDecodeError:
                break  # An object may be incomplete until the next byte chunk.
            objects.append(value)
            self.buffer = self.buffer[offset:]
        return objects


def discover_sensors(accelerometer=None, gyroscope=None):
    if not shutil.which('termux-sensor'):
        raise RuntimeError('termux-sensor tidak tersedia. Pasang Termux:API dan jalankan pkg install termux-api.')
    try:
        result = subprocess.run(['termux-sensor', '-l'], capture_output=True, text=True, timeout=10, check=True)
        data = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise RuntimeError('Daftar sensor gagal dibaca. Periksa aplikasi Termux:API dan izinnya.') from exc
    names = data.get('sensors', []) if isinstance(data, dict) else []
    names = [name for name in names if isinstance(name, str) and 0 < len(name) <= 200 and ',' not in name]
    def choose(explicit, term):
        if explicit:
            if term == 'accel' and any(word in explicit.lower() for word in ('linear', 'gravity', 'uncalibrated')):
                raise RuntimeError('Pilih accelerometer mentah yang menyertakan gravitasi, bukan Linear Acceleration/Gravity/Uncalibrated.')
            if explicit not in names:
                raise RuntimeError(f'Nama {term} tidak cocok. Jalankan termux-sensor -l.')
            return explicit
        return next((name for name in names if term in name.lower() and not any(excluded in name.lower() for excluded in ('uncalibrated', 'linear', 'gravity'))), None)
    accel, gyro = choose(accelerometer, 'accel'), choose(gyroscope, 'gyro')
    if not accel or not gyro:
        raise RuntimeError('Dua sensor wajib belum ditemukan. Periksa termux-sensor -l lalu pilih --accelerometer dan --gyroscope.')
    return accel, gyro


def stop_process(process):
    if process is None:
        return
    try:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=2)
    except (OSError, subprocess.SubprocessError):
        pass


class TermuxSensors:
    def __init__(self, accelerometer, gyroscope, share_location=False, clock=time.monotonic):
        self.accelerometer, self.gyroscope = accelerometer, gyroscope
        self.share_location = share_location
        self.clock = clock
        self.processing = MotionWindow(clock)
        self.stop_event = threading.Event()
        self.process = self.gps_process = None
        self.thread = self.gps_thread = None
        self.error = None
        self.location = None
        self.location_error = 'gps_waiting' if share_location else None
        self.lock = threading.Lock()

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.process = subprocess.Popen(
            ['termux-sensor', '-s', f'{self.accelerometer},{self.gyroscope}', '-d', '100'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        self.thread = threading.Thread(target=self._read_stream, name='sigheat-sensors', daemon=True)
        self.thread.start()
        if self.share_location:
            self.gps_thread = threading.Thread(target=self._read_location, name='sigheat-gps', daemon=True)
            self.gps_thread.start()

    def consume(self, value, timestamp=None):
        """Partial sensor objects update only their own sensor, never the other one."""
        if not isinstance(value, dict):
            return
        now = self.clock() if timestamp is None else timestamp
        if value.get('error'):
            self.error = 'termux_sensor_api_error'
            return
        for name, callback in ((self.accelerometer, self.processing.add_acceleration), (self.gyroscope, self.processing.add_gyroscope)):
            record = value.get(name)
            if isinstance(record, dict):
                callback(record.get('values'), now)

    def _read_stream(self):
        parser = JSONStream()
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                while not self.stop_event.is_set():
                    if not selector.select(timeout=.5):
                        if self.process.poll() is not None:
                            break
                        continue
                    chunk = os.read(self.process.stdout.fileno(), 4096)
                    if not chunk:
                        break
                    for record in parser.feed(chunk):
                        self.consume(record)
            if not self.stop_event.is_set():
                self.error = 'termux_sensor_stream_ended'
        except (OSError, ValueError, RecursionError):
            self.error = 'termux_sensor_stream_invalid'
        finally:
            stop_process(self.process)

    def _read_location(self):
        while not self.stop_event.is_set():
            try:
                if not shutil.which('termux-location'):
                    raise RuntimeError('unavailable')
                with self.lock:
                    if self.stop_event.is_set():
                        return
                    process = subprocess.Popen(['termux-location', '-p', 'gps', '-r', 'once'], stdout=subprocess.PIPE,
                                               stderr=subprocess.DEVNULL, start_new_session=True)
                    self.gps_process = process
                raw, _ = process.communicate(timeout=20)
                if len(raw) > 65536 or process.returncode:
                    raise ValueError('invalid GPS output')
                data = json.loads(raw)
                lat, lon, accuracy = (number(data.get(key), low, high) for key, low, high in
                                      [('latitude', -85, 85), ('longitude', -180, 180), ('accuracy', 0, 100000)])
                if None in (lat, lon, accuracy):
                    raise ValueError('invalid GPS fix')
                with self.lock:
                    self.location = {'latitude': round(lat, 5), 'longitude': round(lon, 5),
                                     'accuracy_m': round(accuracy, 1), 'location_at_ms': int(time.time() * 1000)}
                    self.location_error = None
            except (OSError, subprocess.SubprocessError, ValueError, RuntimeError, AttributeError):
                with self.lock:
                    self.location_error = 'gps_denied_or_unavailable'
                    self.location = None
            finally:
                with self.lock:
                    process = self.gps_process
                    self.gps_process = None
                stop_process(process)
            self.stop_event.wait(15)

    def snapshot(self):
        data = self.processing.snapshot()
        data.update(latitude=None, longitude=None, accuracy_m=None, location_at_ms=None)
        if self.error:
            data['sensor_errors'].append(self.error)
        if self.share_location:
            with self.lock:
                location, error = self.location, self.location_error
            if location and 0 <= int(time.time() * 1000) - location['location_at_ms'] <= 60000:
                data.update(location)
            elif location:
                data['sensor_errors'].append('gps_stale')
            if error:
                data['sensor_errors'].append(error)
        return data

    def stop(self):
        self.stop_event.set()
        stop_process(self.process)
        with self.lock:
            gps = self.gps_process
        stop_process(gps)
        for thread in (self.thread, self.gps_thread):
            if thread and thread is not threading.current_thread():
                thread.join(timeout=3)
        if self.process and self.process.stdout:
            self.process.stdout.close()
