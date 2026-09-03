using Hearthmoor.Core;
using NUnit.Framework;

namespace Hearthmoor.Tests
{
    public class GameClockTests
    {
        const float Dt = Frames.Seconds;

        static int CountFrozenTicks(GameClock clock, int maxTicks)
        {
            int frozen = 0;
            for (int i = 0; i < maxTicks; i++)
            {
                clock.Tick(Dt);
                if (clock.DeltaTime == 0f) frozen++;
                else break;
            }
            return frozen;
        }

        [Test]
        public void NormalTickPassesRealTimeThrough()
        {
            var clock = new GameClock();
            clock.Tick(Dt);
            Assert.AreEqual(Dt, clock.DeltaTime, 1e-7f);
            Assert.AreEqual(1f, clock.CurrentScale);
        }

        [Test]
        public void FreezeStopsTimeForExactlyNFrames()
        {
            var clock = new GameClock();
            clock.Freeze(4);
            Assert.AreEqual(4, CountFrozenTicks(clock, 10));
            Assert.IsFalse(clock.IsFrozen);
        }

        [Test]
        public void LongerFreezeWinsWhenTheyOverlap()
        {
            var clock = new GameClock();
            clock.Freeze(6);
            clock.Freeze(2);
            Assert.AreEqual(6, CountFrozenTicks(clock, 12));
        }

        [Test]
        public void SlowMoScalesDeltaAndThenExpires()
        {
            var clock = new GameClock();
            clock.SlowMo(0.25f, 60);

            clock.Tick(Dt);
            Assert.AreEqual(Dt * 0.25f, clock.DeltaTime, 1e-7f);
            Assert.IsTrue(clock.IsSlowMo);

            for (int i = 0; i < 59; i++) clock.Tick(Dt);
            Assert.IsFalse(clock.IsSlowMo, "slow-mo should end after 60 real frames");

            clock.Tick(Dt);
            Assert.AreEqual(Dt, clock.DeltaTime, 1e-7f);
        }

        [Test]
        public void FreezeOverridesSlowMo()
        {
            var clock = new GameClock();
            clock.SlowMo(0.5f, 30);
            clock.Freeze(2);
            clock.Tick(Dt);
            Assert.AreEqual(0f, clock.DeltaTime);
            Assert.AreEqual(0f, clock.CurrentScale);
        }

        [Test]
        public void ElapsedCountsGameplayTimeOnly()
        {
            var clock = new GameClock();
            clock.Freeze(2);
            clock.Tick(Dt);
            clock.Tick(Dt);
            clock.Tick(Dt);
            Assert.AreEqual(Dt, clock.Elapsed, 1e-7f);
            Assert.AreEqual(3 * Dt, clock.UnscaledElapsed, 1e-6f);
        }

        [Test]
        public void BaseScaleMultipliesEverything()
        {
            var clock = new GameClock { BaseScale = 0.5f };
            clock.Tick(Dt);
            Assert.AreEqual(Dt * 0.5f, clock.DeltaTime, 1e-7f);
        }

        [Test]
        public void ClearEffectsCancelsFreezeAndSlowMo()
        {
            var clock = new GameClock();
            clock.Freeze(10);
            clock.SlowMo(0.1f, 100);
            clock.ClearEffects();
            clock.Tick(Dt);
            Assert.AreEqual(Dt, clock.DeltaTime, 1e-7f);
        }
    }

    public class HitstopTimerTests
    {
        const float Dt = Frames.Seconds;

        [Test]
        public void FreezesTheActorForNFrames()
        {
            var timer = new HitstopTimer();
            timer.Start(3);

            int frozen = 0;
            for (int i = 0; i < 6; i++)
            {
                if (timer.Apply(Dt, Dt) == 0f) frozen++;
                else break;
            }

            Assert.AreEqual(3, frozen);
            Assert.IsFalse(timer.IsActive);
        }

        [Test]
        public void InactiveTimerPassesDeltaThrough()
        {
            var timer = new HitstopTimer();
            Assert.AreEqual(0.5f, timer.Apply(Dt, 0.5f));
        }

        [Test]
        public void LongerHitstopWins()
        {
            var timer = new HitstopTimer();
            timer.Start(2);
            timer.Start(5);

            int frozen = 0;
            for (int i = 0; i < 10; i++)
            {
                if (timer.Apply(Dt, Dt) == 0f) frozen++;
                else break;
            }
            Assert.AreEqual(5, frozen);
        }
    }
}
