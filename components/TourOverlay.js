// components/TourOverlay.js
// Presentational port of the guided-tour overlay markup found inline in the
// Claude Design dashboard comp: an SVG cutout mask around the highlighted
// element, an animated ring, and a tooltip with back/next/skip and step dots.
// Consumes the object returned by lib/useTour.js directly.
//
// Usage:
//   const tour = useTour('dashboard');
//   {tour.active && <TourOverlay tour={tour} />}

export default function TourOverlay({ tour }) {
  if (!tour || !tour.active) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: tour.pointerEvents }}>
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: tour.pointerEvents }}
        viewBox={`0 0 ${tour.vw} ${tour.vh}`}
        preserveAspectRatio="none"
      >
        <path
          d={tour.clipPath}
          fill="color-mix(in srgb, var(--text) 45%, transparent)"
          fillRule="evenodd"
          style={{ transition: 'd .4s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>

      {tour.hasSpot && (
        <div
          style={{
            position: 'absolute',
            left: tour.ringLeft,
            top: tour.ringTop,
            width: tour.ringWidth,
            height: tour.ringHeight,
            borderRadius: 10,
            pointerEvents: 'none',
            border: tour.ringBorder,
            boxShadow: tour.ringGlow,
            animation: 'om-tour-ring 2.2s ease infinite',
            transition:
              'left .4s cubic-bezier(.4,0,.2,1), top .4s cubic-bezier(.4,0,.2,1), width .4s cubic-bezier(.4,0,.2,1), height .4s cubic-bezier(.4,0,.2,1)',
          }}
        />
      )}

      <div
        style={{
          position: 'fixed',
          width: 352,
          background: 'var(--shell)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-lg)',
          fontFamily: "'Manrope',sans-serif",
          pointerEvents: 'all',
          zIndex: 9999,
          left: tour.ttLeft,
          top: tour.ttTop,
          opacity: tour.ttOpacity,
          transition: 'left .4s cubic-bezier(.4,0,.2,1), top .4s cubic-bezier(.4,0,.2,1), opacity .2s ease',
        }}
      >
        <div style={{ padding: '18px 20px 14px' }}>
          <div
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 10,
              fontWeight: 600,
              color: tour.eyebrowColor,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginBottom: 8,
            }}
          >
            {tour.eyebrow}
          </div>
          <div style={{ fontSize: 17.5, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.25, marginBottom: 8 }}>
            {tour.title}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, minHeight: 40 }}>{tour.text}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 16px' }}>
          <button
            type="button"
            onClick={tour.skip}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11.5,
              color: 'var(--faint)',
              fontFamily: "'Manrope',sans-serif",
              padding: '5px 8px',
              borderRadius: 5,
              marginRight: 'auto',
            }}
          >
            Skip tour
          </button>
          {!tour.isClick && (
            <>
              {tour.showBack && (
                <button
                  type="button"
                  onClick={tour.goBack}
                  style={{
                    background: 'none',
                    border: '1px solid var(--line)',
                    borderRadius: 20,
                    padding: '7px 14px',
                    fontSize: 12,
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontFamily: "'Manrope',sans-serif",
                  }}
                >
                  ← Back
                </button>
              )}
              <button
                type="button"
                onClick={tour.goNext}
                style={{
                  border: tour.nextBorder,
                  borderRadius: 20,
                  padding: '8px 18px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: "'Manrope',sans-serif",
                  background: tour.nextBg,
                  color: tour.nextColor,
                }}
              >
                {tour.nextLabel}
              </button>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            borderTop: '1px solid var(--line-soft)',
            fontSize: 11,
            color: 'var(--faint)',
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {tour.dots.map((d, i) => (
              <span key={i} style={{ display: 'inline-block', height: 6, width: d.w, borderRadius: 3, background: d.bg, transition: 'width .3s, background .3s' }} />
            ))}
          </div>
          <span>{tour.progress}</span>
        </div>
      </div>

      <style>{`
        @keyframes om-tour-ring {
          0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
          70% { box-shadow: 0 0 0 8px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </div>
  );
}
