// Tiny NUnit look-alike: just enough surface for the project's EditMode tests to compile and run here.
using System;
namespace NUnit.Framework
{
    [AttributeUsage(AttributeTargets.Method)] public class TestAttribute : Attribute { }
    public class AssertionException : Exception { public AssertionException(string m) : base(m) { } }
    public interface IConstraint { bool Check(object actual, out string why); }
    public static class Is
    {
        public static IConstraint InRange(int lo, int hi) => new RangeConstraint(lo, hi);
        class RangeConstraint : IConstraint
        {
            readonly int _lo, _hi; public RangeConstraint(int lo, int hi) { _lo = lo; _hi = hi; }
            public bool Check(object actual, out string why) { int v = Convert.ToInt32(actual); why = $"{v} not in [{_lo},{_hi}]"; return v >= _lo && v <= _hi; }
        }
    }
    public static class Assert
    {
        static void Fail(string m) => throw new AssertionException(m);
        public static void AreEqual(object expected, object actual, string message = null)
        {
            if (!Equals(expected, actual)) Fail($"{message} expected <{expected}> but was <{actual}>");
        }
        public static void AreEqual(double expected, double actual, double delta, string message = null)
        {
            if (Math.Abs(expected - actual) > delta) Fail($"{message} expected <{expected}> ± {delta} but was <{actual}>");
        }
        public static void IsTrue(bool c, string message = null) { if (!c) Fail(message ?? "expected true"); }
        public static void IsFalse(bool c, string message = null) { if (c) Fail(message ?? "expected false"); }
        public static void That(object actual, IConstraint constraint, string message = null)
        {
            if (!constraint.Check(actual, out string why)) Fail($"{message} {why}");
        }
    }
}
