'use client';

import React from 'react';

type Props = {
  size?: number;     // diameter in px
  className?: string;
  showDigital?: boolean;
};

function getISTHMS() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const h = pick('hour');
  const m = pick('minute');
  const s = pick('second');
  return { h, m, s };
}

export default function AnalogClockIST({ size = 260, className = '', showDigital = true }: Props) {
  const [{ h, m, s }, setTime] = React.useState(getISTHMS);

  // update every second from IST
  React.useEffect(() => {
    const tick = () => setTime(getISTHMS());
    tick();
    const id = setInterval(() => requestAnimationFrame(tick), 1000);
    return () => clearInterval(id);
  }, []);

  // angles
  const sec = s * 6;                                   // 360/60
  const min = m * 6 + s * 0.1;                         // 6° per min + 0.1° per sec
  const hour = (h % 12) * 30 + m * 0.5 + s * (0.5/60); // 30° per hr + drift

  const px = size;
  const handBase = px * 0.5;
  const stroke = Math.max(2, Math.round(px * 0.008));

  return (
    <div className={`ist-clock ${className}`} style={{ '--sz': `${px}px` } as React.CSSProperties} aria-label="Analog clock in IST">
      <div className="bezel">
        <div className="glass" />
        {/* tick marks */}
        {Array.from({ length: 60 }).map((_, i) => (
          <span key={i} className={`tick ${i % 5 === 0 ? 'major' : 'minor'}`} style={{ transform: `rotate(${i * 6}deg)` }} />
        ))}

        {/* hands */}
        <div className="hand hour" style={{ transform: `translate(-50%, -100%) rotate(${hour}deg)`, height: handBase * 0.55 }} />
        <div className="hand minute" style={{ transform: `translate(-50%, -100%) rotate(${min}deg)`, height: handBase * 0.78 }} />
        <div className="hand second" style={{ transform: `translate(-50%, -100%) rotate(${sec}deg)`, height: handBase * 0.85 }} />

        {/* center cap */}
        <div className="cap" />
        <div className="brand">
          <span className="zone">IST</span>
          <span className="city">Asia/Kolkata</span>
        </div>
      </div>

      {showDigital && (
        <div className="digital" aria-label="Digital time IST">
          {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:
          {String(s).padStart(2, '0')} <span>IST</span>
        </div>
      )}

      <style jsx>{`
        .ist-clock {
          --size: var(--sz, 260px);
          --bg: #f7f7f9;
          --fg: #0e0f13;
          --muted: #a5a9b3;
          --accent: #4f46e5;
          --bezel: radial-gradient(120% 120% at 20% 10%, #ededf3, #c7c9d6 40%, #9aa0b3 70%, #7b8194 100%);
          --bezel-dark: radial-gradient(120% 120% at 20% 10%, #2b2f3a, #232733 40%, #1a1e29 70%, #131722 100%);
          --glass: rgba(255, 255, 255, 0.07);

          width: var(--size);
          display: grid;
          place-items: center;
          gap: 12px;
          color: var(--fg);
        }

        @media (prefers-color-scheme: dark) {
          .ist-clock {
            --bg: #0b0d12;
            --fg: #e8eaf1;
            --muted: #8891a7;
            --accent: #8b5cf6;
            --glass: rgba(255, 255, 255, 0.06);
          }
        }

        .bezel {
          position: relative;
          width: var(--size);
          height: var(--size);
          border-radius: 50%;
          background: var(--bg);
          box-shadow:
            inset 0 0 0 2px rgba(255,255,255,0.08),
            inset 0 0 40px rgba(0,0,0,0.25),
            0 20px 40px rgba(0,0,0,0.25);
          overflow: hidden;
          isolation: isolate;
        }

        /* metal ring */
        .bezel::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          padding: 10px;
          background: conic-gradient(from 200deg, transparent 0 40%, rgba(255,255,255,0.08) 40% 50%, transparent 50% 100%), 
                      var(--bezel);
          -webkit-mask:
            radial-gradient(circle at 50% 50%, transparent calc(50% - 12px), #000 calc(50% - 11px));
                  mask:
            radial-gradient(circle at 50% 50%, transparent calc(50% - 12px), #000 calc(50% - 11px));
          z-index: 0;
        }

        @media (prefers-color-scheme: dark) {
          .bezel::before { background: conic-gradient(from 200deg, transparent 0 40%, rgba(255,255,255,0.05) 40% 50%, transparent 50% 100%), var(--bezel-dark); }
        }

        .glass {
          position: absolute;
          inset: 6%;
          border-radius: 50%;
          background:
            radial-gradient(120% 100% at 20% 0%, rgba(255,255,255,0.12), transparent 50%) ,
            linear-gradient(120deg, var(--glass), transparent 60%);
          backdrop-filter: blur(3.5px);
          z-index: 1;
        }

        .tick {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 2px;
          height: calc(var(--size) * 0.48);
          transform-origin: 50% calc(100% - 8px);
          z-index: 2;
        }
        .tick::after {
          content: '';
          position: absolute;
          left: -1px;
          bottom: 8px;
          width: 4px;
          height: 10px;
          border-radius: 2px;
          background: var(--muted);
          opacity: 0.55;
        }
        .tick.minor::after {
          width: 2px;
          height: 6px;
          left: 0px;
          opacity: 0.35;
        }

        .hand {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${stroke * 1.6}px;
          background: var(--fg);
          transform-origin: 50% 100%;
          border-radius: 999px;
          z-index: 3;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));
          transition: transform 0.5s cubic-bezier(.4,.2,.2,1);
        }
        .hand.hour { width: ${stroke * 2.2}px; }
        .hand.minute { width: ${stroke * 1.8}px; opacity: 0.95; }

        .hand.second {
          width: ${Math.max(1, Math.round(stroke * 1.2))}px;
          background: linear-gradient(180deg, var(--accent), var(--fg) 85%);
          transition: transform 0.2s cubic-bezier(.4,.2,.2,1);
        }

        .cap {
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${Math.round(px * 0.06)}px;
          height: ${Math.round(px * 0.06)}px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #fff7, transparent),
                      radial-gradient(circle at 70% 70%, #0005, transparent),
                      var(--fg);
          box-shadow:
            0 0 0 2px rgba(255,255,255,0.15),
            inset 0 0 6px rgba(0,0,0,0.35);
          z-index: 4;
        }

        .brand {
          position: absolute;
          bottom: 10%;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          font-size: 12px;
          line-height: 1.1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          z-index: 5;
          user-select: none;
          pointer-events: none;
        }
        .brand .city { font-size: 10px; opacity: 0.7; }

        .digital {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--fg);
          opacity: 0.9;
        }
        .digital span { opacity: 0.6; margin-left: 6px; font-weight: 500; }
      `}</style>
    </div>
  );
}
