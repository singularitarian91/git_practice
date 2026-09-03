using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

namespace Hearthmoor.Setup
{
    /// <summary>
    /// Step 1 of project setup: install the packages the rest of the code depends on.
    /// Lives in its own tiny assembly with no dependencies, so this menu exists even
    /// before those packages are present (the other Hearthmoor assemblies stay dormant
    /// until they are — see the defineConstraints in their .asmdef files).
    /// </summary>
    public static class PackageInstaller
    {
        // Added without a version so Unity picks the release verified for this editor.
        static readonly string[] Required =
        {
            "com.unity.render-pipelines.universal",
            "com.unity.inputsystem",
            "com.unity.cinemachine",
            "com.unity.test-framework",
            "com.unity.ugui",
        };

        // Survives the recompile that follows a package install (SessionState does; statics don't).
        const string InstallingKey = "Hearthmoor.PackageInstaller.Installing";

        static ListRequest _list;
        static AddAndRemoveRequest _add;

        /// <summary>
        /// Runs after every recompile. If we kicked off an install before this reload and the
        /// game assemblies now exist, print the next step — the update callback that would have
        /// reported it is lost when the editor reloads.
        /// </summary>
        [InitializeOnLoadMethod]
        static void AfterReload()
        {
            if (!SessionState.GetBool(InstallingKey, false)) return;
            if (!IsAssemblyLoaded("Hearthmoor.Runtime")) return;

            SessionState.EraseBool(InstallingKey);
            Debug.Log("[Hearthmoor] Packages installed and code compiled ✓  Next: Tools ▸ Hearthmoor ▸ 2 · Configure Project");
        }

        static bool IsAssemblyLoaded(string name) =>
            System.AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetName().Name == name);

        [MenuItem("Tools/Hearthmoor/1 · Install Packages", priority = 0)]
        public static void Install()
        {
            if (_list != null || _add != null)
            {
                Debug.Log("[Hearthmoor] A package operation is already running — give it a moment.");
                return;
            }

            Debug.Log("[Hearthmoor] Checking installed packages…");
            _list = Client.List(true, false);
            EditorApplication.update += PollList;
        }

        static void PollList()
        {
            if (!_list.IsCompleted) return;
            EditorApplication.update -= PollList;

            if (_list.Status != StatusCode.Success)
            {
                Debug.LogError("[Hearthmoor] Could not read the package list: " + _list.Error?.message);
                _list = null;
                return;
            }

            var installed = new HashSet<string>(_list.Result.Select(p => p.name));
            string[] missing = Required.Where(id => !installed.Contains(id)).ToArray();
            _list = null;

            if (missing.Length == 0)
            {
                Debug.Log("[Hearthmoor] All required packages are already installed ✓  Next: Tools ▸ Hearthmoor ▸ 2 · Configure Project");
                return;
            }

            Debug.Log("[Hearthmoor] Installing: " + string.Join(", ", missing) + " — the editor will recompile when done.");
            SessionState.SetBool(InstallingKey, true);
            _add = Client.AddAndRemove(missing, null);
            EditorApplication.update += PollAdd;
        }

        static void PollAdd()
        {
            if (!_add.IsCompleted) return;
            EditorApplication.update -= PollAdd;

            if (_add.Status == StatusCode.Success)
                Debug.Log("[Hearthmoor] Packages installed ✓  Wait for the compile spinner to finish, then run Tools ▸ Hearthmoor ▸ 2 · Configure Project");
            else
                Debug.LogError("[Hearthmoor] Package install failed: " + _add.Error?.message);

            _add = null;
        }

        [MenuItem("Tools/Hearthmoor/Check Status", priority = 100)]
        public static void CheckStatus()
        {
            var loaded = System.AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetName().Name)
                .Where(n => n.StartsWith("Hearthmoor."))
                .OrderBy(n => n)
                .ToList();

            var report = new System.Text.StringBuilder("[Hearthmoor] Status\n");
            report.AppendLine("  Unity " + Application.unityVersion);
            report.AppendLine("  Assemblies compiled: " + string.Join(", ", loaded));
            report.AppendLine(loaded.Contains("Hearthmoor.Runtime")
                ? "  Hearthmoor.Runtime ✓  (packages present, code compiled)"
                : "  Hearthmoor.Runtime — dormant. Run Tools ▸ Hearthmoor ▸ 1 · Install Packages, then wait for the compile.");
            report.AppendLine("  Render pipeline: " + (UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline != null
                ? UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline.name
                : "NONE (built-in) — expected a URP asset; see docs/SETUP.md troubleshooting"));
            report.AppendLine("  Fixed timestep: " + Time.fixedDeltaTime + " s (" + Mathf.RoundToInt(1f / Time.fixedDeltaTime) + " Hz)");
            report.AppendLine("  Enter Play Mode options: " + (EditorSettings.enterPlayModeOptionsEnabled ? "on — " + EditorSettings.enterPlayModeOptions : "off"));
            report.AppendLine("  Layer 8: '" + LayerMask.LayerToName(8) + "'  (expect 'Ground' after Configure Project)");
            Debug.Log(report.ToString());
        }
    }
}
