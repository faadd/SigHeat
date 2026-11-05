/* Generated offline by scripts/build-default-model.cjs. SYNTHETIC bootstrap, not field validation. */
(function(root, factory) { const model = factory(); if (typeof module === "object" && module.exports) module.exports = model; else root.SigHeatDefaultModel = model; })(typeof globalThis !== "undefined" ? globalThis : this, function() { return {
  "format": "sigheat-ridge-context-v1",
  "schema_version": 1,
  "scope": "bootstrap",
  "context_key": null,
  "window": 6,
  "features": [
    "rtt_lag_0",
    "rtt_lag_1",
    "rtt_lag_2",
    "rtt_lag_3",
    "rtt_lag_4",
    "rtt_lag_5",
    "rtt_mean_6",
    "rtt_std_6",
    "rtt_slope_6",
    "success_pct",
    "latency_std_ms",
    "accel_rms",
    "gyro_rms_rad_s",
    "accel_missing",
    "gyro_missing",
    "jitter_missing"
  ],
  "centers": [
    163.60362982456112,
    163.78727368421028,
    163.9539421052629,
    164.11488070175415,
    164.2709526315787,
    164.42267368421028,
    164.02555877192978,
    6.0906259034013095,
    -0.16380877192982432,
    100,
    9.874984210526318,
    0.1998977368421053,
    0.08032077192982458,
    0,
    0,
    0
  ],
  "scales": [
    67.59795601971759,
    67.50223311244747,
    67.40280877937712,
    67.29109797533486,
    67.17521503644403,
    67.05179566478789,
    66.97198529134437,
    3.467204718731055,
    3.903661051506121,
    1,
    5.087179789631126,
    0.08496441253967131,
    0.01747512958867449,
    1,
    1,
    1
  ],
  "coefficients": [
    48.1599427202716,
    -32.61428898898687,
    -16.86522860858837,
    6.814711980224583,
    7.854470067092169,
    43.71765432340894,
    9.543181745344025,
    -0.13807617607168418,
    16.608330538139267,
    0,
    0.05824477638487857,
    0.08384118764686238,
    -0.22803955427596717,
    0,
    0,
    0
  ],
  "intercept": 163.4056508771927,
  "alpha": 0.1,
  "provenance": "synthetic",
  "horizon_s": 5,
  "training_interval_s": 5,
  "trained_through_ms": 1767228475000,
  "evaluated_through_ms": 1767230395000,
  "validation": {
    "ridge": {
      "n": 186,
      "mae_ms": 2.6584426891521082,
      "rmse_ms": 3.1073564982867894
    },
    "persistence": {
      "n": 186,
      "mae_ms": 4.089854838709679,
      "rmse_ms": 4.885267880417702
    },
    "moving_average": {
      "n": 186,
      "mae_ms": 12.342849462365596,
      "rmse_ms": 14.142473115582371
    }
  },
  "test": {
    "ridge": {
      "n": 186,
      "mae_ms": 2.042686346799193,
      "rmse_ms": 2.5456533796548717
    },
    "persistence": {
      "n": 186,
      "mae_ms": 3.7206075268817194,
      "rmse_ms": 4.4181581155962055
    },
    "moving_average": {
      "n": 186,
      "mae_ms": 11.639793010752685,
      "rmse_ms": 13.212232434267223
    }
  },
  "report": {
    "algorithm": "standardized_ridge_autoregression",
    "context_key": "[\"demo-ml\",\"hp-demo\",\"demo\",\"wss://example.invalid/mqtt\",5,\"linear\"]",
    "provenance": "synthetic",
    "target": "next_successful_immediate_mqtt_app_rtt_ms",
    "horizon_s": 5,
    "rows": {
      "total": 960,
      "train": 576,
      "validation": 192,
      "test": 192
    },
    "examples": {
      "train": 570,
      "validation": 186,
      "test": 186
    },
    "excluded_windows": {
      "train": 0,
      "validation": 0,
      "test": 0
    },
    "split_boundaries": {
      "train": {
        "raw_start_ms": 1767225600000,
        "raw_end_ms": 1767228475000,
        "first_input_ms": 1767225600000,
        "first_target_ms": 1767225630000,
        "last_input_ms": 1767228470000,
        "last_target_ms": 1767228475000
      },
      "validation": {
        "raw_start_ms": 1767228480000,
        "raw_end_ms": 1767229435000,
        "first_input_ms": 1767228480000,
        "first_target_ms": 1767228510000,
        "last_input_ms": 1767229430000,
        "last_target_ms": 1767229435000
      },
      "test": {
        "raw_start_ms": 1767229440000,
        "raw_end_ms": 1767230395000,
        "first_input_ms": 1767229440000,
        "first_target_ms": 1767229470000,
        "last_input_ms": 1767230390000,
        "last_target_ms": 1767230395000
      }
    },
    "features": [
      "rtt_lag_0",
      "rtt_lag_1",
      "rtt_lag_2",
      "rtt_lag_3",
      "rtt_lag_4",
      "rtt_lag_5",
      "rtt_mean_6",
      "rtt_std_6",
      "rtt_slope_6",
      "success_pct",
      "latency_std_ms",
      "accel_rms",
      "gyro_rms_rad_s",
      "accel_missing",
      "gyro_missing",
      "jitter_missing"
    ],
    "alpha": 0.1,
    "validation": {
      "ridge": {
        "n": 186,
        "mae_ms": 2.6584426891521082,
        "rmse_ms": 3.1073564982867894
      },
      "persistence": {
        "n": 186,
        "mae_ms": 4.089854838709679,
        "rmse_ms": 4.885267880417702
      },
      "moving_average": {
        "n": 186,
        "mae_ms": 12.342849462365596,
        "rmse_ms": 14.142473115582371
      }
    },
    "test": {
      "ridge": {
        "n": 186,
        "mae_ms": 2.042686346799193,
        "rmse_ms": 2.5456533796548717
      },
      "persistence": {
        "n": 186,
        "mae_ms": 3.7206075268817194,
        "rmse_ms": 4.4181581155962055
      },
      "moving_average": {
        "n": 186,
        "mae_ms": 11.639793010752685,
        "rmse_ms": 13.212232434267223
      }
    },
    "note": "Validasi kronologis memilih alpha. Ini evaluasi historis, bukan bukti performa masa depan. Kandidat adaptif harus dinilai lagi pada target yang datang setelah kandidat dibekukan. Statistik koneksi yang sudah diringkas perangkat dapat memuat observasi sebelumnya; tidak memakai masa depan."
  },
  "model_id": "ridge-bootstrap-d6a568e0",
  "applicability": {
    "sources": [
      "browser",
      "termux",
      "demo"
    ],
    "interval_min_s": 2,
    "interval_max_s": 60,
    "accel_modes": [
      "linear",
      "gravity_removed",
      "unavailable"
    ]
  },
  "source_note": "Model awal dilatih offline pada data sintetis dengan interval 5 detik. Transfer ke perangkat, mode sensor, dan interval lain bersifat eksperimental dan belum tervalidasi lapangan."
}; });
