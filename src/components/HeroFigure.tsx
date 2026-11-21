// Иллюстрация на главной: «страница лабораторного журнала» с гистограммой цен и точечной диаграммой.
export function HeroFigure() {
  const bars = [62, 120, 150, 118, 86, 60, 40, 26, 16, 10, 6];
  return (
    <svg viewBox="0 0 420 320" className="h-auto w-full" role="img" aria-label="Набросок: гистограмма цен автомобилей и зависимость цены от года выпуска">
      <rect x="6" y="6" width="408" height="308" rx="6" fill="var(--bg-elev)" stroke="var(--border)" />
      <g stroke="var(--grid-line)" strokeWidth="1">
        {Array.from({ length: 18 }, (_, i) => (
          <line key={`v${i}`} x1={6 + i * 23} y1="6" x2={6 + i * 23} y2="314" />
        ))}
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`h${i}`} x1="6" y1={6 + i * 24} x2="414" y2={6 + i * 24} />
        ))}
      </g>
      <line x1="34" y1="6" x2="34" y2="314" stroke="var(--bad)" strokeOpacity="0.35" />
      {/* гистограмма */}
      <text x="48" y="34" fontFamily="var(--font-serif)" fontSize="14" fontStyle="italic" fill="var(--warm-text)">
        цены объявлений, €
      </text>
      <g transform="translate(48 170)">
        {bars.map((h, i) => (
          <rect key={i} x={i * 17} y={-h * 0.8} width="14" height={h * 0.8} fill="var(--accent)" fillOpacity={0.15 + (i === 2 ? 0.6 : 0.35)} rx="1.5" />
        ))}
        <line x1="-2" y1="0" x2="190" y2="0" stroke="var(--text)" strokeOpacity="0.6" />
        <line x1="48" y1="-136" x2="48" y2="6" stroke="var(--warm)" strokeWidth="2" strokeDasharray="4 3" />
        <text x="54" y="-124" fontSize="11" fill="var(--warm-text)" fontFamily="var(--font-mono)">
          медиана 6600
        </text>
        <text x="0" y="18" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
          0
        </text>
        <text x="150" y="18" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
          40 000
        </text>
      </g>
      {/* точечная диаграмма */}
      <text x="248" y="34" fontFamily="var(--font-serif)" fontSize="14" fontStyle="italic" fill="var(--warm-text)">
        цена ↔ год
      </text>
      <g transform="translate(250 170)">
        <line x1="0" y1="0" x2="150" y2="0" stroke="var(--text)" strokeOpacity="0.6" />
        <line x1="0" y1="0" x2="0" y2="-125" stroke="var(--text)" strokeOpacity="0.6" />
        {[
          [8, -10], [14, -14], [20, -12], [27, -20], [33, -18], [38, -27], [45, -24], [52, -33], [58, -38], [64, -36], [70, -46], [77, -50],
          [83, -47], [90, -60], [96, -66], [102, -62], [109, -78], [115, -84], [121, -80], [128, -96], [134, -104], [140, -112], [60, -70], [30, -8], [100, -40],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="var(--accent)" fillOpacity="0.55" />
        ))}
        <path d="M4 -6 C 50 -26, 100 -60, 146 -116" fill="none" stroke="var(--warm)" strokeWidth="2.2" />
      </g>
      {/* код */}
      <g fontFamily="var(--font-mono)" fontSize="12">
        <rect x="48" y="204" width="352" height="92" rx="4" fill="var(--bg-code)" stroke="var(--border)" />
        <text x="58" y="226" fill="var(--accent-text)">In [3]:</text>
        <text x="118" y="226" fill="var(--text)">
          np.median(price_values)
        </text>
        <text x="58" y="250" fill="var(--warm-text)">Out[3]:</text>
        <text x="118" y="250" fill="var(--text)">
          6600.0
        </text>
        <text x="58" y="278" fill="var(--ok)">✓ Все проверки пройдены!</text>
      </g>
    </svg>
  );
}
