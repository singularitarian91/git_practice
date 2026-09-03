using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Hearthmoor.EditorTools
{
    /// <summary>
    /// Optional step 3: fold the files Unity's "Universal 3D" template created into the
    /// _Hearthmoor layout and remove its tutorial content. Everything is moved with the
    /// AssetDatabase so references (Graphics settings → URP asset, etc.) stay intact.
    /// </summary>
    public static class TemplateTidy
    {
        [MenuItem("Tools/Hearthmoor/3 · Tidy Template Files", priority = 2)]
        public static void Tidy()
        {
            bool ok = EditorUtility.DisplayDialog(
                "Tidy template files?",
                "Moves the URP template's Settings folder into _Hearthmoor/Settings, moves its sample scene and input asset into _Hearthmoor, and deletes TutorialInfo + Readme.\n\nNothing you created is touched.",
                "Tidy", "Cancel");
            if (!ok) return;

            var report = new StringBuilder("[Hearthmoor] Tidy Template Files\n");

            MoveFolderContents("Assets/Settings", ProjectFolders.Root + "/Settings", report);
            Move("Assets/Scenes/SampleScene.unity", ProjectFolders.Root + "/Scenes/Template_SampleScene.unity", report);
            Move("Assets/InputSystem_Actions.inputactions", ProjectFolders.Root + "/Input/Template_InputSystem_Actions.inputactions", report);
            Delete("Assets/TutorialInfo", report);
            Delete("Assets/Readme.asset", report);
            DeleteIfEmpty("Assets/Scenes", report);
            DeleteIfEmpty("Assets/Settings", report);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log(report.ToString());
        }

        static bool Exists(string path) =>
            AssetDatabase.IsValidFolder(path) || AssetDatabase.LoadMainAssetAtPath(path) != null;

        static void Move(string src, string dst, StringBuilder report)
        {
            if (!Exists(src))
            {
                report.AppendLine($"  = {src} not found (already tidied?)");
                return;
            }

            ProjectFolders.Ensure(Path.GetDirectoryName(dst).Replace('\\', '/'));
            string error = AssetDatabase.MoveAsset(src, dst);
            report.AppendLine(string.IsNullOrEmpty(error) ? $"  → {src}  →  {dst}" : $"  ! {src}: {error}");
        }

        static void MoveFolderContents(string srcFolder, string dstFolder, StringBuilder report)
        {
            if (!AssetDatabase.IsValidFolder(srcFolder))
            {
                report.AppendLine($"  = {srcFolder} not found (already tidied?)");
                return;
            }

            ProjectFolders.Ensure(dstFolder);
            foreach (string entry in Directory.GetFileSystemEntries(srcFolder))
            {
                string name = Path.GetFileName(entry);
                if (name.EndsWith(".meta") || name.StartsWith(".")) continue;
                Move(srcFolder + "/" + name, dstFolder + "/" + name, report);
            }
        }

        static void Delete(string path, StringBuilder report)
        {
            if (!Exists(path)) return;
            report.AppendLine(AssetDatabase.DeleteAsset(path) ? $"  − deleted {path}" : $"  ! could not delete {path}");
        }

        static void DeleteIfEmpty(string folder, StringBuilder report)
        {
            if (!AssetDatabase.IsValidFolder(folder)) return;
            bool hasContent = Directory.EnumerateFileSystemEntries(folder)
                .Select(entry => Path.GetFileName(entry))
                .Any(n => !n.EndsWith(".meta") && !n.StartsWith("."));
            if (!hasContent && AssetDatabase.DeleteAsset(folder))
                report.AppendLine($"  − removed empty {folder}");
        }
    }
}
