using Hearthmoor.Controls;
using Hearthmoor.Core;
using NUnit.Framework;

namespace Hearthmoor.Tests
{
    public class InputBufferTests
    {
        static float F(int frames) => Frames.ToSeconds(frames);

        [Test]
        public void PressIsConsumableInsideTheWindow()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Light, 0f);
            Assert.IsTrue(buffer.TryConsume(GameButton.Light, F(9)));
        }

        [Test]
        public void PressExpiresAfterTheWindow()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Light, 0f);
            Assert.IsFalse(buffer.TryConsume(GameButton.Light, F(11)));
        }

        [Test]
        public void ConsumedPressCannotFireTwice()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Jump, 0f);
            Assert.IsTrue(buffer.TryConsume(GameButton.Jump, F(1)));
            Assert.IsFalse(buffer.TryConsume(GameButton.Jump, F(2)));
        }

        [Test]
        public void PeekDoesNotConsume()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Heavy, 0f);
            Assert.IsTrue(buffer.Peek(GameButton.Heavy, F(1)));
            Assert.IsTrue(buffer.TryConsume(GameButton.Heavy, F(1)));
        }

        [Test]
        public void OtherButtonsAreUnaffected()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Light, 0f);
            Assert.IsFalse(buffer.TryConsume(GameButton.Heavy, F(1)));
            Assert.IsTrue(buffer.TryConsume(GameButton.Light, F(1)));
        }

        [Test]
        public void TwoPressesGiveTwoConsumes()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Light, 0f);
            buffer.Press(GameButton.Light, F(3));
            Assert.IsTrue(buffer.TryConsume(GameButton.Light, F(4)));
            Assert.IsTrue(buffer.TryConsume(GameButton.Light, F(4)));
            Assert.IsFalse(buffer.TryConsume(GameButton.Light, F(4)));
        }

        [Test]
        public void ClearForgetsEverything()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Dodge, 0f);
            buffer.Clear();
            Assert.IsFalse(buffer.TryConsume(GameButton.Dodge, F(1)));
            Assert.AreEqual(0, buffer.Count);
        }

        [Test]
        public void PruneDropsConsumedAndExpiredEntries()
        {
            var buffer = new InputBuffer(10);
            buffer.Press(GameButton.Light, 0f);
            buffer.Press(GameButton.Heavy, 0f);
            buffer.TryConsume(GameButton.Light, F(1));

            buffer.Prune(F(1));
            Assert.AreEqual(1, buffer.Count, "consumed entry should be pruned, live one kept");

            buffer.Prune(F(11));
            Assert.AreEqual(0, buffer.Count, "expired entry should be pruned");
        }
    }
}
