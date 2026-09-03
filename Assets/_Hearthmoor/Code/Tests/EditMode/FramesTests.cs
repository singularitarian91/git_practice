using Hearthmoor.Core;
using NUnit.Framework;

namespace Hearthmoor.Tests
{
    public class FramesTests
    {
        [Test]
        public void SixtyFramesIsOneSecond()
        {
            Assert.AreEqual(1f, Frames.ToSeconds(60), 1e-6f);
        }

        [Test]
        public void HalfASecondIsThirtyFrames()
        {
            Assert.AreEqual(30, Frames.ToFrames(0.5f));
        }

        [Test]
        public void FramesSurviveARoundTripThroughSeconds()
        {
            for (int f = 0; f < 600; f++)
                Assert.AreEqual(f, Frames.ToFrames(Frames.ToSeconds(f)), $"frame {f}");
        }

        [Test]
        public void WindowIsInclusiveOnBothEnds()
        {
            Assert.IsTrue(Frames.InWindow(8, 8, 11));
            Assert.IsTrue(Frames.InWindow(11, 8, 11));
            Assert.IsFalse(Frames.InWindow(7, 8, 11));
            Assert.IsFalse(Frames.InWindow(12, 8, 11));
        }
    }
}
