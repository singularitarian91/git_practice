using System.Text;
using UnityEditor;

namespace Hearthmoor.EditorTools
{
    /// <summary>Creates the _Hearthmoor folder layout inside the Unity project (idempotent).</summary>
    public static class ProjectFolders
    {
        public const string Root = "Assets/_Hearthmoor";

        public static readonly string[] All =
        {
            Root + "/Code/Runtime/Core",
            Root + "/Code/Runtime/Input",
            Root + "/Code/Runtime/Actors",
            Root + "/Code/Runtime/Combat",
            Root + "/Code/Runtime/Feel",
            Root + "/Code/Runtime/AI",
            Root + "/Code/Runtime/World",
            Root + "/Code/Runtime/View",
            Root + "/Code/Runtime/UI",
            Root + "/Code/Editor",
            Root + "/Code/Setup",
            Root + "/Code/Tests/EditMode",
            Root + "/Data/Moves",
            Root + "/Data/MoveSets",
            Root + "/Data/Actors",
            Root + "/Data/Feel",
            Root + "/Data/World",
            Root + "/Prefabs/Player",
            Root + "/Prefabs/Enemies",
            Root + "/Prefabs/Greybox",
            Root + "/Prefabs/VFX",
            Root + "/Art/Placeholder",
            Root + "/Art/Characters",
            Root + "/Art/Environment",
            Root + "/Art/Shaders",
            Root + "/Audio",
            Root + "/Scenes",
            Root + "/Settings",
            Root + "/Input",
            "Assets/ThirdParty",
            "Assets/Plugins",
        };

        public static void EnsureAll(StringBuilder report)
        {
            int created = 0;
            foreach (string folder in All)
                if (Ensure(folder)) created++;
            report.AppendLine(created == 0 ? "  = Folder layout already complete" : $"  + Created {created} missing folder(s)");
        }

        /// <summary>Create <paramref name="path"/> (and any missing parents). Returns true if anything was created.</summary>
        public static bool Ensure(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return false;

            string[] parts = path.Split('/');
            string current = parts[0];
            bool created = false;

            for (int i = 1; i < parts.Length; i++)
            {
                string next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[i]);
                    created = true;
                }
                current = next;
            }
            return created;
        }
    }
}
