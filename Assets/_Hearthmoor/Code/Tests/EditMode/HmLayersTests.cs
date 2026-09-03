using System.Linq;
using Hearthmoor.Core;
using NUnit.Framework;

namespace Hearthmoor.Tests
{
    public class HmLayersTests
    {
        [Test]
        public void UserLayerNamesAreUnique()
        {
            var names = HmLayers.UserLayers.Select(l => l.name).ToList();
            Assert.AreEqual(names.Count, names.Distinct().Count());
        }

        [Test]
        public void UserLayerSlotsAreUniqueAndInUserRange()
        {
            var slots = HmLayers.UserLayers.Select(l => l.index).ToList();
            Assert.AreEqual(slots.Count, slots.Distinct().Count());
            foreach (int slot in slots)
                Assert.That(slot, Is.InRange(8, 31), "Unity reserves slots 0–7");
        }

        [Test]
        public void NoCollisionPairsOnlyNameKnownLayers()
        {
            var known = HmLayers.UserLayers.Select(l => l.name).Append(HmLayers.Default).Append(HmLayers.Water).ToHashSet();
            foreach ((string a, string b) in HmLayers.NoCollision)
            {
                Assert.IsTrue(known.Contains(a), $"unknown layer '{a}'");
                Assert.IsTrue(known.Contains(b), $"unknown layer '{b}'");
            }
        }

        [Test]
        public void HurtboxesCollideWithNothing()
        {
            // Every layer must appear in a no-collision pair with each hurtbox layer.
            var all = HmLayers.UserLayers.Select(l => l.name).Append(HmLayers.Default).Append(HmLayers.Water).ToList();
            foreach (string hurtbox in new[] { HmLayers.PlayerHurtbox, HmLayers.EnemyHurtbox })
            {
                foreach (string other in all)
                {
                    bool listed = HmLayers.NoCollision.Any(p =>
                        (p.a == hurtbox && p.b == other) || (p.a == other && p.b == hurtbox));
                    Assert.IsTrue(listed, $"{hurtbox} should ignore {other}");
                }
            }
        }
    }
}
