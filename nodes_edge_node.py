import time
import json
import os
import sys
from dotenv import load_dotenv
import paho.mqtt.client as mqtt

# Append folder shared ke sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from shared.sensors import read_network_latency, calculate_motion_rms
from shared.processing import SignalProcessor

load_dotenv()
PROJECT_ID = os.getenv("PROJECT_ID", "sigheat_demo")
MQTT_HOST = os.getenv("MQTT_HOST", "broker.hivemq.com")
MQTT_PORT = int(os.getenv("MQTT_PORT", 8883))

# Ganti role menjadi 'node1' di HP 1 dan 'node2' di HP 2
DEVICE_ROLE = sys.argv[1] if len(sys.argv) > 1 else "node1"

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, f"sigheat_{DEVICE_ROLE}")
client.tls_set()  # Port 8883 (TLS/SSL)

processor = SignalProcessor(alpha=0.3)

print(f"[{DEVICE_ROLE.upper()}] Menghubungkan ke MQTT Broker ({MQTT_HOST})...")
client.connect(MQTT_HOST, MQTT_PORT, 60)
client.loop_start()

topic = f"sigheat/{PROJECT_ID}/edge/{DEVICE_ROLE}/telemetry"
sequence = 0

try:
    while True:
        sequence += 1
        raw_rtt = read_network_latency()
        smoothed_rtt = processor.apply_ema(raw_rtt)
        status_zone = processor.classify_zone(smoothed_rtt)
        
        # Contoh nilai dummy accelerometer jika dijalankan tanpa Termux API
        rms_val = calculate_motion_rms(0.1, 0.2, 9.85)

        payload = {
            "device_id": DEVICE_ROLE,
            "sequence": sequence,
            "raw_rtt_ms": raw_rtt,
            "smoothed_rtt_ms": smoothed_rtt,
            "motion_rms": rms_val,
            "status_zone": status_zone,
            "timestamp": int(time.time() * 1000)
        }

        client.publish(topic, json.dumps(payload), qos=1)
        print(f"[{DEVICE_ROLE}] Sent #{sequence} | RTT: {raw_rtt}ms -> EMA: {smoothed_rtt}ms | Status: {status_zone}")
        time.sleep(2)
except KeyboardInterrupt:
    print("\n[EDGE] Berhenti mengirim data.")
    client.loop_stop()
    client.disconnect()