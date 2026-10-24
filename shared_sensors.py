import time
import math
import urllib.request

def read_network_latency(target_url="https://www.google.com"):
    """Mengukur latensi jaringan (RTT / Ping) dalam milidetik."""
    start_time = time.time()
    try:
        req = urllib.request.Request(target_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as response:
            pass
        latency_ms = (time.time() - start_time) * 1000
    except Exception:
        latency_ms = 300.0  # Fallback nilai tinggi jika timeout
    return round(latency_ms, 2)

def calculate_motion_rms(accel_x, accel_y, accel_z):
    """Menghitung RMS percepatan getaran accelerometer."""
    GRAVITY = 9.81
    magnitude = math.sqrt(accel_x**2 + accel_y**2 + accel_z**2)
    error = abs(magnitude - GRAVITY)
    return round(error, 3)