using System;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
public static class Runner
{
    public static int Main()
    {
        int pass = 0, fail = 0;
        var tests = Assembly.GetExecutingAssembly().GetTypes()
            .SelectMany(t => t.GetMethods().Where(m => m.GetCustomAttribute<TestAttribute>() != null).Select(m => (t, m)))
            .OrderBy(x => x.t.Name).ThenBy(x => x.m.Name);
        foreach (var (t, m) in tests)
        {
            try { m.Invoke(Activator.CreateInstance(t), null); pass++; Console.WriteLine($"  ok   {t.Name}.{m.Name}"); }
            catch (TargetInvocationException e) { fail++; Console.WriteLine($"  FAIL {t.Name}.{m.Name}: {e.InnerException?.Message}"); }
        }
        Console.WriteLine($"\n{pass} passed, {fail} failed");
        return fail == 0 ? 0 : 1;
    }
}
