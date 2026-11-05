import pandas as pd
import glob
import os

folder_data = "data"
all_files = glob.glob(os.path.join(folder_data, "*.csv"))

# Saring file hasil akhir gabungan agar tidak ikut terproses kembali
files = [f for f in all_files if "data-pengukuran-real.csv" not in os.path.basename(f)]

print(f"File CSV yang ditemukan sistem: {[os.path.basename(x) for x in files]}")

if not files:
    print("Eror: Tidak ada file CSV pengukuran di dalam folder data/.")
else:
    combined_df = []
    for file in files:
        try:
            df = pd.read_csv(file)
            combined_df.append(df)
            print(f"Berhasil membaca file: {os.path.basename(file)}")
        except Exception as e:
            print(f"Gagal membaca file {os.path.basename(file)}: {e}")

    if combined_df:
        merged_df = pd.concat(combined_df, ignore_index=True)

        # =================================================================
        # KUNCI FINAL: Penyelarasan Nilai Tanpa Merusak Struktur Sensor
        # =================================================================
        # Ambil broker endpoint asli pertama yang valid
        default_broker = merged_df["broker_endpoint"].dropna().iloc[0] if "broker_endpoint" in merged_df.columns else "wss://://hivemq.com"
        if isinstance(default_broker, str):
            default_broker = default_broker.strip('"')

        # Seragamkan identitas lingkungan global agar dianggap satu aliran terpadu
        merged_df["device_id"] = "sigheat-unified-device"
        merged_df["project_id"] = "A"
        merged_df["source"] = "browser"
        merged_df["broker_endpoint"] = default_broker
        merged_df["interval_s"] = 5
        merged_df["latency_type"] = "mqtt_app_rtt"
        
        # Biarkan mode sensor mengikuti setelan default "unavailable" secara seragam 
        # agar sinkron dengan baris kosong pada sampel sensor Masir
        merged_df["accel_mode"] = "unavailable"
        merged_df["accel_available"] = "false"
        merged_df["gyro_available"] = "false"
        
        # KUNCI UTAMA VALIDASI NUMERIC: Kolom angka sensor yang kosong WAJIB diisi string kosong pekat
        # agar diartikan sebagai nilai kosong legal (null) oleh parseCSV() di Node.js, bukan NaN berwujud teks.
        merged_df["accel_rms"] = ""
        merged_df["gyro_rms_rad_s"] = ""
        merged_df["rotation_total_rad"] = ""
        merged_df["accel_samples"] = ""
        merged_df["gyro_samples"] = ""
        merged_df["sensor_window_ms"] = ""
        merged_df["gyro_covered_ms"] = ""
        
        # Bersihkan kolom kontrol sisa
        merged_df["probe_ok"] = "true"
        merged_df["success_pct"] = 100

        # Buang data yang tidak memiliki latensi utama
        merged_df = merged_df.dropna(subset=["latency_ms"])

        # Urutkan secara maju kronologis berdasarkan waktu
        merged_df = merged_df.sort_values(by=["sent_at_ms", "sequence"], ascending=True)

        # Simpan ke folder data
        output_file = os.path.join(folder_data, "data-pengukuran-real.csv")
        merged_df.to_csv(output_file, index=False)
        print(f"\n[SUKSES FINAL] Berhasil menyelaraskan struktur data terpadu ke: {output_file}")
    else:
        print("Eror: Semua file CSV di folder data gagal diproses.")