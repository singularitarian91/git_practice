using System.Collections.Generic;
using Hearthmoor.Core;

namespace Hearthmoor.Controls
{
    /// <summary>Every button the game understands. Physical bindings live in Hearthmoor.inputactions.</summary>
    public enum GameButton
    {
        Jump,
        Light,
        Heavy,
        Dodge,
        Guard,
        Sprint,
        LockOn,
        Interact,
    }

    /// <summary>
    /// Remembers button presses for a short window so a press that arrives a few frames early
    /// (for example during the tail of a swing) still counts when the next state looks for it.
    /// This is the invisible reason responsive games feel responsive.
    ///
    /// Timestamps are gameplay time (<see cref="CombatClock.Elapsed"/>), so the window pauses
    /// during hitstop and stretches during slow-mo — which is what you want.
    /// Pure C# with no Unity dependency so it can be unit-tested.
    /// </summary>
    public sealed class InputBuffer
    {
        struct Entry
        {
            public GameButton Button;
            public float Time;
            public bool Consumed;
        }

        readonly List<Entry> _entries = new List<Entry>(16);

        /// <summary>How long a press stays valid, in seconds. Default: 10 frames.</summary>
        public float Window = Frames.ToSeconds(10);

        public InputBuffer() { }

        public InputBuffer(int windowFrames)
        {
            Window = Frames.ToSeconds(windowFrames);
        }

        /// <summary>Number of stored entries, including consumed and expired ones not yet pruned.</summary>
        public int Count => _entries.Count;

        /// <summary>Record a press of <paramref name="button"/> at gameplay time <paramref name="now"/>.</summary>
        public void Press(GameButton button, float now)
        {
            _entries.Add(new Entry { Button = button, Time = now, Consumed = false });
        }

        /// <summary>Is there an unconsumed press of <paramref name="button"/> inside the window? Does not consume it.</summary>
        public bool Peek(GameButton button, float now) => IndexOfNewest(button, now) >= 0;

        /// <summary>Take the newest valid press of <paramref name="button"/> so it can't trigger twice. False if there is none.</summary>
        public bool TryConsume(GameButton button, float now)
        {
            int i = IndexOfNewest(button, now);
            if (i < 0) return false;

            Entry e = _entries[i];
            e.Consumed = true;
            _entries[i] = e;
            return true;
        }

        /// <summary>Forget every press — e.g. on entering hitstun, so a stale press doesn't fire on recovery.</summary>
        public void Clear() => _entries.Clear();

        /// <summary>Drop consumed and expired entries. Call once per frame.</summary>
        public void Prune(float now)
        {
            for (int i = _entries.Count - 1; i >= 0; i--)
            {
                if (_entries[i].Consumed || now - _entries[i].Time > Window)
                    _entries.RemoveAt(i);
            }
        }

        int IndexOfNewest(GameButton button, float now)
        {
            for (int i = _entries.Count - 1; i >= 0; i--)
            {
                Entry e = _entries[i];
                if (e.Consumed || e.Button != button) continue;
                if (now - e.Time > Window) continue;
                return i;
            }
            return -1;
        }
    }
}
