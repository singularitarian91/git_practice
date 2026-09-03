using UnityEngine;

namespace Hearthmoor.Core
{
    /// <summary>
    /// The physics layers Hearthmoor uses — the single source of truth.
    /// Tools ▸ Hearthmoor ▸ 2 · Configure Project writes these into Project Settings;
    /// gameplay code reads them from here instead of typing layer names by hand.
    /// </summary>
    public static class HmLayers
    {
        // Unity's own built-in layers we rely on.
        public const string Default = "Default";
        public const string Water = "Water"; // built-in layer 4; reused rather than duplicated

        public const string Ground = "Ground";               // walkable / blocking world
        public const string Climbable = "Climbable";         // blocking world the player can climb
        public const string Player = "Player";               // the player's body capsule
        public const string Enemy = "Enemy";                 // enemy body capsules
        public const string PlayerHurtbox = "PlayerHurtbox"; // where enemy attacks can hit the player
        public const string EnemyHurtbox = "EnemyHurtbox";   // where player attacks can hit enemies
        public const string Projectile = "Projectile";
        public const string Prop = "Prop";                   // physics objects: crates, boulders
        public const string Interactable = "Interactable";   // things you can press Interact on

        /// <summary>Each custom layer and the user slot (8–31) Configure Project assigns it.</summary>
        public static readonly (string name, int index)[] UserLayers =
        {
            (Ground, 8),
            (Climbable, 9),
            (Player, 10),
            (Enemy, 11),
            (PlayerHurtbox, 12),
            (EnemyHurtbox, 13),
            (Projectile, 14),
            (Prop, 15),
            (Interactable, 16),
        };

        /// <summary>
        /// Layer pairs that must NOT collide; every other pair collides (Unity's default).
        /// Hurtboxes are found by overlap queries, never by collision, so they touch nothing.
        /// </summary>
        public static readonly (string a, string b)[] NoCollision =
        {
            (PlayerHurtbox, Default), (PlayerHurtbox, Water), (PlayerHurtbox, Ground), (PlayerHurtbox, Climbable),
            (PlayerHurtbox, Player), (PlayerHurtbox, Enemy), (PlayerHurtbox, PlayerHurtbox), (PlayerHurtbox, EnemyHurtbox),
            (PlayerHurtbox, Projectile), (PlayerHurtbox, Prop), (PlayerHurtbox, Interactable),

            (EnemyHurtbox, Default), (EnemyHurtbox, Water), (EnemyHurtbox, Ground), (EnemyHurtbox, Climbable),
            (EnemyHurtbox, Player), (EnemyHurtbox, Enemy), (EnemyHurtbox, EnemyHurtbox),
            (EnemyHurtbox, Projectile), (EnemyHurtbox, Prop), (EnemyHurtbox, Interactable),

            (Projectile, Projectile),
        };

        /// <summary>Layer index for <paramref name="layerName"/>, or -1 (with a warning) if the project isn't configured.</summary>
        public static int Index(string layerName)
        {
            int index = LayerMask.NameToLayer(layerName);
            if (index < 0)
                Debug.LogWarning($"[Hearthmoor] Layer '{layerName}' is missing. Run Tools ▸ Hearthmoor ▸ 2 · Configure Project.");
            return index;
        }

        public static int Mask(params string[] layerNames) => LayerMask.GetMask(layerNames);

        // Common query masks, so callers never build them by hand.

        /// <summary>Everything a character can stand on or bump into.</summary>
        public static int WalkableMask => Mask(Default, Ground, Climbable, Prop);

        /// <summary>Surfaces the climb probe accepts.</summary>
        public static int ClimbableMask => Mask(Climbable);

        /// <summary>What the player's attacks look for.</summary>
        public static int EnemyHurtboxMask => Mask(EnemyHurtbox);

        /// <summary>What enemy attacks look for.</summary>
        public static int PlayerHurtboxMask => Mask(PlayerHurtbox);
    }
}
