using UnityEditor;
using UnityEngine;

namespace Hearthmoor.EditorTools
{
    /// <summary>Flat-colour URP materials for greybox geometry. Deleted wholesale when real art lands.</summary>
    public static class PlaceholderMaterials
    {
        public const string Folder = ProjectFolders.Root + "/Art/Placeholder";

        public static Material GetOrCreate(string name, Color color)
        {
            string path = Folder + "/" + name + ".mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null) return existing;

            ProjectFolders.Ensure(Folder);

            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
            {
                Debug.LogWarning("[Hearthmoor] URP Lit shader not found — is URP active? Falling back to Standard.");
                shader = Shader.Find("Standard");
            }

            var mat = new Material(shader) { name = name };
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", color);
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", color);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.15f);

            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }
    }
}
