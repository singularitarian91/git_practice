// Minimal stand-ins for the UnityEngine API used by the pure-logic runtime files under test.
// Only exists so the real code + tests can be compiled and run outside the Unity Editor.
using System;
namespace UnityEngine
{
    public static class Mathf
    {
        public static int RoundToInt(float f) => (int)Math.Round(f, MidpointRounding.AwayFromZero);
        public static float Max(float a, float b) => a > b ? a : b;
        public static float Clamp(float v, float min, float max) => v < min ? min : (v > max ? max : v);
    }
    public class Object { public string name; public static implicit operator bool(Object o) => o != null; }
    public class Component : Object { }
    public class Behaviour : Component { public bool enabled = true; }
    public class MonoBehaviour : Behaviour { }
    public static class Time
    {
        public static float unscaledDeltaTime = 1f / 60f;
        public static float deltaTime = 1f / 60f;
        public static float time = 0f;
        public static float fixedDeltaTime = 0.02f;
    }
    public static class Debug
    {
        public static void LogWarning(object msg) => Console.WriteLine("[warn] " + msg);
        public static void LogWarning(object msg, Object ctx) => Console.WriteLine("[warn] " + msg);
        public static void Log(object msg) => Console.WriteLine("[log] " + msg);
        public static void LogError(object msg) => Console.WriteLine("[error] " + msg);
    }
    public static class LayerMask
    {
        static readonly string[] Names = { "Default", "TransparentFX", "Ignore Raycast", "", "Water", "UI", "", "",
            "Ground", "Climbable", "Player", "Enemy", "PlayerHurtbox", "EnemyHurtbox", "Projectile", "Prop", "Interactable" };
        public static int NameToLayer(string n) => Array.IndexOf(Names, n);
        public static int GetMask(params string[] names) { int m = 0; foreach (var n in names) { int i = NameToLayer(n); if (i >= 0) m |= 1 << i; } return m; }
    }
    [AttributeUsage(AttributeTargets.All)] public class TooltipAttribute : Attribute { public TooltipAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.All)] public class RangeAttribute : Attribute { public RangeAttribute(float a, float b) { } }
    [AttributeUsage(AttributeTargets.All)] public class DefaultExecutionOrder : Attribute { public DefaultExecutionOrder(int i) { } }
    [AttributeUsage(AttributeTargets.All)] public class DisallowMultipleComponent : Attribute { }
    [AttributeUsage(AttributeTargets.All)] public class AddComponentMenu : Attribute { public AddComponentMenu(string s) { } }
    public enum RuntimeInitializeLoadType { AfterSceneLoad, BeforeSceneLoad, AfterAssembliesLoaded, BeforeSplashScreen, SubsystemRegistration }
    [AttributeUsage(AttributeTargets.Method)] public class RuntimeInitializeOnLoadMethodAttribute : Attribute { public RuntimeInitializeOnLoadMethodAttribute(RuntimeInitializeLoadType t) { } }
}
