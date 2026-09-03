using System.Linq;
using System.Text;
using Hearthmoor.Core;
using UnityEditor;
using UnityEngine;

namespace Hearthmoor.EditorTools
{
    /// <summary>
    /// Step 2 of project setup. One click configures everything the code assumes:
    /// layers, the collision matrix, 60 Hz physics, fast play-mode entry, text serialisation,
    /// the folder layout, and the sandbox scene. Safe to run again at any time.
    /// </summary>
    public static class ProjectConfigurator
    {
        [MenuItem("Tools/Hearthmoor/2 · Configure Project", priority = 1)]
        public static void Configure()
        {
            var report = new StringBuilder("[Hearthmoor] Configure Project\n");

            ConfigureLayers(report);
            ConfigureCollisionMatrix(report);
            ConfigureTime(report);
            ConfigureEditorSettings(report);
            ConfigureInputHandling(report);
            ProjectFolders.EnsureAll(report);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            SandboxSceneBuilder.BuildOrOpen(report);

            report.AppendLine("Done. Next: Window ▸ General ▸ Test Runner ▸ EditMode ▸ Run All (expect all green), then press Play.");
            Debug.Log(report.ToString());
        }

        static void ConfigureLayers(StringBuilder report)
        {
            Object tagManagerAsset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset").FirstOrDefault();
            if (tagManagerAsset == null)
            {
                report.AppendLine("  ! Could not open ProjectSettings/TagManager.asset — add the layers by hand (see HmLayers.cs)");
                return;
            }

            var tagManager = new SerializedObject(tagManagerAsset);
            SerializedProperty layers = tagManager.FindProperty("layers");
            int added = 0;

            foreach ((string name, int index) in HmLayers.UserLayers)
            {
                int existing = LayerMask.NameToLayer(name);
                if (existing == index) continue;
                if (existing >= 0)
                {
                    report.AppendLine($"  = Layer '{name}' already exists at slot {existing} (wanted {index}) — fine, leaving it");
                    continue;
                }

                SerializedProperty slot = layers.GetArrayElementAtIndex(index);
                if (!string.IsNullOrEmpty(slot.stringValue))
                {
                    report.AppendLine($"  ! Layer slot {index} is taken by '{slot.stringValue}'; wanted '{name}'. Free it in Project Settings ▸ Tags and Layers, then re-run.");
                    continue;
                }

                slot.stringValue = name;
                added++;
            }

            tagManager.ApplyModifiedProperties();
            report.AppendLine(added == 0 ? "  = Layers already configured" : $"  + Added {added} layer(s)");
        }

        static void ConfigureCollisionMatrix(StringBuilder report)
        {
            int applied = 0, skipped = 0;
            foreach ((string a, string b) in HmLayers.NoCollision)
            {
                int la = LayerMask.NameToLayer(a);
                int lb = LayerMask.NameToLayer(b);
                if (la < 0 || lb < 0) { skipped++; continue; }
                Physics.IgnoreLayerCollision(la, lb, true);
                applied++;
            }
            report.AppendLine($"  + Collision matrix: {applied} pair(s) set to ignore" + (skipped > 0 ? $", {skipped} skipped (missing layer)" : ""));
        }

        static void ConfigureTime(StringBuilder report)
        {
            const float step = 1f / Frames.TickRate;
            Object timeManager = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TimeManager.asset").FirstOrDefault();
            if (timeManager != null)
            {
                var so = new SerializedObject(timeManager);
                SerializedProperty fixedStep = so.FindProperty("Fixed Timestep");
                if (fixedStep != null)
                {
                    fixedStep.floatValue = step;
                    so.ApplyModifiedProperties();
                }
            }
            Time.fixedDeltaTime = step;
            report.AppendLine($"  + Physics fixed timestep = 1/{Frames.TickRate} s");
        }

        static void ConfigureEditorSettings(StringBuilder report)
        {
            EditorSettings.serializationMode = SerializationMode.ForceText;
            VersionControlSettings.mode = "Visible Meta Files";
            EditorSettings.enterPlayModeOptionsEnabled = true;
            EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
            report.AppendLine("  + Text serialisation, visible meta files, fast Enter Play Mode (domain reload off)");
        }

        static void ConfigureInputHandling(StringBuilder report)
        {
            // 0 = old Input Manager only, 1 = Input System package only, 2 = both.
            Object projectSettings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset").FirstOrDefault();
            if (projectSettings == null) return;

            var so = new SerializedObject(projectSettings);
            SerializedProperty handler = so.FindProperty("activeInputHandler");
            if (handler == null) return;

            if (handler.intValue == 0)
            {
                handler.intValue = 2;
                so.ApplyModifiedProperties();
                report.AppendLine("  ! Input handling switched to 'Both' — RESTART THE EDITOR (File ▸ Exit, reopen from the Hub), then run this again");
            }
            else
            {
                report.AppendLine("  = Input System package is active");
            }
        }
    }
}
