using System.Linq;
using System.Text;
using Hearthmoor.Core;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Hearthmoor.EditorTools
{
    /// <summary>
    /// Builds Sandbox_Combat: a flat greybox arena with stairs, slopes, a climbing wall and a tower,
    /// plus spawn markers and the CombatClock. This is where most Milestone 1 tuning happens.
    /// </summary>
    public static class SandboxSceneBuilder
    {
        public const string ScenePath = ProjectFolders.Root + "/Scenes/Sandbox_Combat.unity";

        [MenuItem("Tools/Hearthmoor/Rebuild Sandbox Scene", priority = 50)]
        public static void RebuildFromMenu()
        {
            var report = new StringBuilder("[Hearthmoor] Rebuild Sandbox Scene\n");
            Build(report, force: true);
            Debug.Log(report.ToString());
        }

        /// <summary>Open the sandbox if it exists, otherwise build it.</summary>
        public static void BuildOrOpen(StringBuilder report)
        {
            if (System.IO.File.Exists(ScenePath))
            {
                if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                    EditorSceneManager.OpenScene(ScenePath);
                report.AppendLine("  = Sandbox_Combat already exists; opened it (Tools ▸ Hearthmoor ▸ Rebuild Sandbox Scene regenerates it)");
                return;
            }
            Build(report, force: false);
        }

        static void Build(StringBuilder report, bool force)
        {
            if (force && System.IO.File.Exists(ScenePath))
            {
                bool ok = EditorUtility.DisplayDialog(
                    "Rebuild Sandbox_Combat?",
                    "This replaces the scene file. Anything you placed in it by hand will be lost.",
                    "Rebuild", "Cancel");
                if (!ok) return;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;

            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            Material ground = PlaceholderMaterials.GetOrCreate("Mat_Ground", new Color(0.42f, 0.52f, 0.34f));
            Material block = PlaceholderMaterials.GetOrCreate("Mat_Greybox", new Color(0.62f, 0.60f, 0.56f));
            Material climb = PlaceholderMaterials.GetOrCreate("Mat_Climbable", new Color(0.55f, 0.42f, 0.32f));

            Transform world = new GameObject("Greybox").transform;

            Block(world, "Ground", new Vector3(0, -0.5f, 0), new Vector3(80, 1, 80), Quaternion.identity, ground, HmLayers.Ground);

            // Stairs of 0.3 m steps up to a platform — tests the motor's step-up height.
            for (int i = 0; i < 4; i++)
            {
                float h = 0.3f * (i + 1);
                Block(world, "Stair_" + (i + 1), new Vector3(8 + i, h * 0.5f, 0), new Vector3(1, h, 4), Quaternion.identity, block, HmLayers.Ground);
            }
            Block(world, "Stair_Top", new Vector3(13.5f, 0.6f, 0), new Vector3(6, 1.2f, 4), Quaternion.identity, block, HmLayers.Ground);

            // Two slopes — one walkable, one too steep — to tune the slope limit.
            Block(world, "Slope_20", new Vector3(-9, 1.0f, 4), new Vector3(7, 0.6f, 6), Quaternion.Euler(0, 0, 20), block, HmLayers.Ground);
            Block(world, "Slope_45", new Vector3(-9, 2.2f, -6), new Vector3(7, 0.6f, 6), Quaternion.Euler(0, 0, 45), block, HmLayers.Ground);

            // Climbing wall and a tower: step 3 (climb & glide) uses these.
            Block(world, "ClimbWall", new Vector3(0, 3, 14), new Vector3(10, 6, 1), Quaternion.identity, climb, HmLayers.Climbable);
            Block(world, "Tower", new Vector3(-20, 6, 14), new Vector3(4, 12, 4), Quaternion.identity, climb, HmLayers.Climbable);
            Block(world, "Pillar", new Vector3(5, 1.5f, -8), new Vector3(1.5f, 3, 1.5f), Quaternion.identity, block, HmLayers.Ground);

            // Where later steps will drop the player, the training dummy and enemies.
            Transform spawns = new GameObject("SpawnPoints").transform;
            Marker(spawns, "PlayerSpawn", new Vector3(0, 0, -4));
            Marker(spawns, "DummySpawn", new Vector3(0, 0, 3));
            Marker(spawns, "EnemySpawn_A", new Vector3(6, 0, 6));
            Marker(spawns, "EnemySpawn_B", new Vector3(-6, 0, 6));

            var systems = new GameObject("GameSystems");
            systems.AddComponent<CombatClock>();

            Camera cam = Camera.main;
            if (cam != null)
            {
                cam.transform.position = new Vector3(0, 4.5f, -11);
                cam.transform.LookAt(new Vector3(0, 1, 0));
            }

            Light sun = UnityEngine.Object.FindFirstObjectByType<Light>();
            if (sun != null)
            {
                sun.name = "Sun";
                sun.transform.rotation = Quaternion.Euler(48, -32, 0);
                sun.color = new Color(1f, 0.95f, 0.86f);
            }

            ProjectFolders.Ensure(ProjectFolders.Root + "/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            AddToBuildSettings(ScenePath);
            report.AppendLine("  + Built " + ScenePath);
        }

        static GameObject Block(Transform parent, string name, Vector3 center, Vector3 size, Quaternion rotation, Material material, string layer)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(center, rotation);
            go.transform.localScale = size;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            go.isStatic = true;

            int layerIndex = LayerMask.NameToLayer(layer);
            if (layerIndex >= 0) go.layer = layerIndex;
            return go;
        }

        static void Marker(Transform parent, string name, Vector3 position)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = position;
        }

        static void AddToBuildSettings(string path)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.Any(s => s.path == path)) return;
            scenes.Add(new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
