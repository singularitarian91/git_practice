namespace Hearthmoor.Core
{
    /// <summary>
    /// Per-actor hitstop. When a hit lands, the attacker and the victim each start one of these;
    /// while it runs, that actor's own delta time is zero (it freezes) while the rest of the
    /// world keeps moving — the Smash Bros "hitlag" feel. Counted in real (unscaled) frames.
    /// </summary>
    public sealed class HitstopTimer
    {
        const float Epsilon = 1e-5f;

        float _remaining;

        public bool IsActive => _remaining > Epsilon;

        /// <summary>Freeze this actor for <paramref name="frames"/>. Overlapping calls keep the longer duration.</summary>
        public void Start(int frames)
        {
            float seconds = Frames.ToSeconds(frames);
            if (seconds > _remaining) _remaining = seconds;
        }

        /// <summary>
        /// Advance by one real frame and return the delta this actor should use this frame:
        /// 0 while frozen, otherwise <paramref name="gameplayDelta"/> unchanged.
        /// </summary>
        public float Apply(float unscaledDelta, float gameplayDelta)
        {
            if (_remaining > Epsilon)
            {
                _remaining -= unscaledDelta;
                return 0f;
            }
            return gameplayDelta;
        }

        public void Clear() => _remaining = 0f;
    }
}
