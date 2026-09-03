using UnityEngine;

namespace Hearthmoor.Core
{
    /// <summary>
    /// Scene component that ticks the one <see cref="GameClock"/> every frame.
    /// Gameplay code reads <see cref="DeltaTime"/> instead of Time.deltaTime so that
    /// hitstop and slow-mo affect every system identically — nothing can drift out of sync.
    /// Put exactly one in each scene (the Sandbox builder does this for you).
    /// If a scene has none, the statics fall back to Unity's own time so nothing silently stops.
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    [DisallowMultipleComponent]
    [AddComponentMenu("Hearthmoor/Core/Combat Clock")]
    public sealed class CombatClock : MonoBehaviour
    {
        static CombatClock _instance;
        static readonly GameClock _detached = new GameClock();
        static bool _warnedMissing;

        [Tooltip("Base game speed. 1 = normal. Debug tools may change this at runtime.")]
        [Range(0.05f, 2f)]
        public float baseScale = 1f;

        /// <summary>The clock this component drives.</summary>
        public readonly GameClock Clock = new GameClock();

        /// <summary>The active clock. Effects (Freeze / SlowMo) on the detached fallback do nothing.</summary>
        public static GameClock Current => _instance != null ? _instance.Clock : _detached;

        /// <summary>Gameplay seconds elapsed this frame (0 during a global freeze).</summary>
        public static float DeltaTime => _instance != null ? _instance.Clock.DeltaTime : FallbackDelta();

        /// <summary>Gameplay seconds since the scene started. Use this for input-buffer timestamps.</summary>
        public static float Elapsed => _instance != null ? _instance.Clock.Elapsed : Time.time;

        /// <summary>True while a CombatClock is present and driving time.</summary>
        public static bool IsPresent => _instance != null;

        // "Reload Domain" is disabled in Enter Play Mode options for fast iteration, which means
        // static fields survive between play sessions. This resets them at the start of each one.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            _instance = null;
            _warnedMissing = false;
            _detached.ClearEffects();
        }

        static float FallbackDelta()
        {
            if (!_warnedMissing)
            {
                _warnedMissing = true;
                Debug.LogWarning("[Hearthmoor] No CombatClock in the scene — using Time.deltaTime. Hitstop and slow-mo won't work until one is added.");
            }
            return Time.deltaTime;
        }

        void OnEnable()
        {
            if (_instance != null && _instance != this)
            {
                Debug.LogWarning($"[Hearthmoor] Two CombatClocks in the scene; disabling the one on '{name}'.", this);
                enabled = false;
                return;
            }
            _instance = this;
        }

        void OnDisable()
        {
            if (_instance == this) _instance = null;
        }

        void Update()
        {
            Clock.BaseScale = baseScale;
            Clock.Tick(Time.unscaledDeltaTime);
        }
    }
}
