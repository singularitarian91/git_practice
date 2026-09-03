using UnityEngine;

namespace Hearthmoor.Core
{
    /// <summary>
    /// Frame ↔ second conversion. Every combat timing in Hearthmoor is authored in
    /// frames at <see cref="TickRate"/> (the way fighting games describe moves) and
    /// converted to seconds here, so the game plays identically at any real framerate.
    /// </summary>
    public static class Frames
    {
        /// <summary>The authoring rate. "Active on frames 8–11" means at 60 frames per second.</summary>
        public const int TickRate = 60;

        /// <summary>Length of one authored frame, in seconds.</summary>
        public const float Seconds = 1f / TickRate;

        public static float ToSeconds(int frames) => frames * Seconds;

        public static float ToSeconds(float frames) => frames * Seconds;

        /// <summary>Seconds → whole frames, rounded to the nearest frame.</summary>
        public static int ToFrames(float seconds) => Mathf.RoundToInt(seconds * TickRate);

        /// <summary>Seconds → frames without rounding, for "which frame are we on" bookkeeping.</summary>
        public static float ToFramesExact(float seconds) => seconds * TickRate;

        /// <summary>True when <paramref name="frame"/> lies inside the inclusive window [start, end].</summary>
        public static bool InWindow(int frame, int start, int end) => frame >= start && frame <= end;
    }
}
