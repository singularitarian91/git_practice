using UnityEngine;

namespace Hearthmoor.Core
{
    /// <summary>
    /// The single source of "how much gameplay time passed this frame".
    /// Pure C# so it can be unit-tested; <see cref="CombatClock"/> is the scene component that ticks it.
    ///
    /// Two world-wide effects, both counted in real (unscaled) frames:
    ///  • <see cref="Freeze"/>  — global hitstop: gameplay time stops entirely for N frames.
    ///  • <see cref="SlowMo"/>  — the world runs at a fraction of speed for N frames (perfect dodge).
    /// Per-actor hitstop (only the two fighters freeze) is <see cref="HitstopTimer"/>, layered on top.
    /// </summary>
    public sealed class GameClock
    {
        const float Epsilon = 1e-5f;

        /// <summary>Designer-controlled base speed (1 = normal). Debug tools use this.</summary>
        public float BaseScale = 1f;

        float _freezeRemaining;
        float _slowMoRemaining;
        float _slowMoScale = 1f;

        /// <summary>Gameplay seconds that passed in the last <see cref="Tick"/> (0 while frozen).</summary>
        public float DeltaTime { get; private set; }

        /// <summary>Total gameplay seconds elapsed. Stops during freezes, crawls during slow-mo.</summary>
        public float Elapsed { get; private set; }

        /// <summary>Real seconds elapsed, unaffected by any effect.</summary>
        public float UnscaledElapsed { get; private set; }

        /// <summary>The speed multiplier that applied in the last tick (0 while frozen).</summary>
        public float CurrentScale { get; private set; } = 1f;

        public bool IsFrozen => _freezeRemaining > Epsilon;

        public bool IsSlowMo => _slowMoRemaining > Epsilon;

        /// <summary>Advance the clock by one real frame of <paramref name="unscaledDelta"/> seconds.</summary>
        public void Tick(float unscaledDelta)
        {
            UnscaledElapsed += unscaledDelta;

            if (_freezeRemaining > Epsilon)
            {
                _freezeRemaining -= unscaledDelta;
                CurrentScale = 0f;
                DeltaTime = 0f;
                return;
            }

            float scale = BaseScale;
            if (_slowMoRemaining > Epsilon)
            {
                _slowMoRemaining -= unscaledDelta;
                scale *= _slowMoScale;
            }

            CurrentScale = scale;
            DeltaTime = unscaledDelta * scale;
            Elapsed += DeltaTime;
        }

        /// <summary>Stop gameplay time for <paramref name="frames"/> real frames. Overlapping freezes keep the longer one.</summary>
        public void Freeze(int frames)
        {
            _freezeRemaining = Mathf.Max(_freezeRemaining, Frames.ToSeconds(frames));
        }

        /// <summary>Run the world at <paramref name="scale"/> speed for <paramref name="frames"/> real frames.</summary>
        public void SlowMo(float scale, int frames)
        {
            _slowMoScale = Mathf.Clamp(scale, 0.01f, 1f);
            _slowMoRemaining = Frames.ToSeconds(frames);
        }

        /// <summary>Cancel any freeze or slow-mo in progress.</summary>
        public void ClearEffects()
        {
            _freezeRemaining = 0f;
            _slowMoRemaining = 0f;
            _slowMoScale = 1f;
        }
    }
}
