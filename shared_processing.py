class SignalProcessor:
    def __init__(self, alpha=0.3):
        self.alpha = alpha  # Faktor smoothing EMA
        self.ema_rtt = None

    def apply_ema(self, new_rtt):
        """Algoritma 1: Exponential Moving Average (EMA) untuk pemulusan data."""
        if self.ema_rtt is None:
            self.ema_rtt = new_rtt
        else:
            self.ema_rtt = (self.alpha * new_rtt) + ((1 - self.alpha) * self.ema_rtt)
        return round(self.ema_rtt, 2)

    def classify_zone(self, smoothed_rtt):
        """Algoritma 2: Rule-Based Thresholding untuk klasifikasi zona jaringan."""
        if smoothed_rtt < 80:
            return "GOOD_ZONE"
        elif smoothed_rtt < 180:
            return "MODERATE_ZONE"
        else:
            return "DEAD_ZONE"