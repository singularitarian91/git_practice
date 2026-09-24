"""
Procedural animation library for the Figment rig (see build_figure.py).

Every clip is a function f(t) -> pose, with t in [0, 1] over the clip's length.
A pose maps bone name -> (pitch X, yaw Y, roll Z) in degrees, in three.js axes:
  X = character's left, Y = up, Z = forward.
    thigh/upperarm X < 0  : swing forward      shin X > 0   : knee bends
    forearm X < 0         : elbow bends fwd    foot X > 0   : toe points down
    spine/chest X > 0     : lean forward       Y > 0        : turn toward left
    upperarmL Z > 0 / upperarmR Z < 0 : arm raised out to the side
'<bone>@loc' gives a translation (x, y, z) in metres (hips: y = up/down).

UPPER bones are replaced by the upper-body overlay layer in game
(aim / fire / reload ...); LOWER bones always come from locomotion.
"""
import math

PROCEDURAL_BONES = {'root', 'scarf1', 'scarf2', 'scarf3', 'appleFace', 'muzzleTake', 'muzzleGive'}
UPPER = ['chest', 'neck', 'head', 'upperarmL', 'forearmL', 'handL', 'upperarmR', 'forearmR', 'handR',
         'gun', 'gunHammer', 'gunCylinder', 'gunBreak', 'gunVial', 'gunBlade']
# bones whose neutral pose isn't the rest pose: the bayonet is folded back under the barrel
DEFAULTS = {'gunBlade': (178, 0, 0)}
LOWER = ['hips', 'spine', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']

TAU = 2 * math.pi
sin, cos = math.sin, math.cos


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def sm(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def seg(t, a, b):
    """0..1 progress of t through [a, b] (clamped, smoothstepped)."""
    return sm((t - a) / (b - a))


def lin(t, a, b):
    return clamp((t - a) / (b - a))


def bump(t, a, peak, b):
    """0 -> 1 -> 0 envelope."""
    if t <= a or t >= b:
        return 0.0
    return sm((t - a) / (peak - a)) if t < peak else 1 - sm((t - peak) / (b - peak))


def add(p, bone, x=0, y=0, z=0):
    ox, oy, oz = p.get(bone, (0, 0, 0))
    p[bone] = (ox + x, oy + y, oz + z)


def addloc(p, bone, x=0, y=0, z=0):
    k = bone + '@loc'
    ox, oy, oz = p.get(k, (0, 0, 0))
    p[k] = (ox + x, oy + y, oz + z)


def blend(a, b, w):
    out = {}
    for k in set(a) | set(b):
        va = a.get(k, (0, 0, 0))
        vb = b.get(k, (0, 0, 0))
        out[k] = tuple(x + (y - x) * w for x, y in zip(va, vb))
    return out


# ---------------------------------------------------------------------------
# Shared sub-poses
# ---------------------------------------------------------------------------
def gun_low(p, w=1.0):
    """Relaxed low-ready: gun angled forward-down."""
    add(p, 'upperarmR', -18 * w, 0, -9 * w)
    add(p, 'forearmR', -38 * w, 12 * w, 0)
    add(p, 'handR', -8 * w, 0, 0)


def gun_run(p, phase):
    add(p, 'upperarmR', -34 - 5 * sin(phase), 4, -12)
    add(p, 'forearmR', -48, 10, 0)
    add(p, 'handR', -4, 0, 0)


def aim_upper(p):
    """Two-handed aim, torso twisted so the right shoulder leads."""
    add(p, 'chest', 3, 18, 0)
    add(p, 'neck', 0, -8, 0)
    add(p, 'head', 2, -10, 0)
    add(p, 'upperarmR', -86, -16, -4)
    add(p, 'forearmR', -4, 0, 0)
    add(p, 'handR', -2, 0, 0)
    add(p, 'upperarmL', -58, -48, 8)
    add(p, 'forearmL', -52, 0, 0)
    add(p, 'handL', 0, 0, 30)


def stand(p):
    addloc(p, 'hips', 0, -0.015, 0)
    add(p, 'spine', 3, 0, 0)
    add(p, 'chest', 2, 6, 0)
    add(p, 'neck', 0, -3, 0)
    add(p, 'head', -2, -3, 0)
    add(p, 'thighL', -4, 4, 4)
    add(p, 'shinL', 7, 0, 0)
    add(p, 'footL', -3, 0, -4)
    add(p, 'thighR', 5, -6, -4)
    add(p, 'shinR', 9, 0, 0)
    add(p, 'footR', -6, 0, 4)
    add(p, 'upperarmL', 4, 0, 8)
    add(p, 'forearmL', -18, 0, 0)


def run_legs(p, ph, stride=40, knee=85, lean=12, bounce=1.0):
    s, c = sin(ph), cos(ph)
    add(p, 'thighL', -stride * s, 0, 0)
    add(p, 'thighR', stride * s, 0, 0)
    add(p, 'shinL', 14 + knee * max(0.0, c) ** 1.4 + 12 * max(0.0, -c))
    add(p, 'shinR', 14 + knee * max(0.0, -c) ** 1.4 + 12 * max(0.0, c))
    add(p, 'footL', 22 * max(0.0, cos(ph + 0.7)) - 14 * max(0.0, s))
    add(p, 'footR', 22 * max(0.0, cos(ph + math.pi + 0.7)) - 14 * max(0.0, -s))
    addloc(p, 'hips', 0, (-0.05 - 0.035 * cos(2 * ph)) * bounce, 0)
    add(p, 'hips', 0, -10 * s, 3 * sin(2 * ph))
    add(p, 'spine', lean, 0, 0)
    add(p, 'chest', 4, 12 * s, 0)
    add(p, 'neck', -4, -5 * s, 0)
    add(p, 'head', -8, -5 * s, 0)


def run_left_arm(p, ph, amp=40):
    add(p, 'upperarmL', amp * sin(ph), 0, 9)
    add(p, 'forearmL', -78 - 12 * sin(ph), 0, 0)


# ---------------------------------------------------------------------------
# Locomotion
# ---------------------------------------------------------------------------
def Idle(t):
    p = {}
    ph = TAU * t
    stand(p)
    addloc(p, 'hips', 0.008 * sin(ph), 0.004 * sin(2 * ph), 0)
    add(p, 'hips', 0, 0, 1.5 * sin(ph))
    add(p, 'spine', 1.2 * sin(2 * ph), 0, -1.5 * sin(ph))
    add(p, 'chest', 1.5 * sin(2 * ph + 0.5), 0, 0)
    add(p, 'head', 1.0 * sin(2 * ph + 1.0), 3 * sin(ph), 0)
    gun_low(p)
    add(p, 'upperarmR', 2 * sin(2 * ph), 0, 0)
    add(p, 'upperarmL', 1.5 * sin(2 * ph + 0.8), 0, 0)
    return p


def Run(t):
    p = {}
    ph = TAU * t
    run_legs(p, ph)
    run_left_arm(p, ph)
    gun_run(p, ph)
    return p


def Sprint(t):
    p = {}
    ph = TAU * t
    run_legs(p, ph, stride=52, knee=105, lean=22, bounce=1.2)
    run_left_arm(p, ph, 55)
    add(p, 'upperarmR', 30 * sin(ph + math.pi) * 0.4 - 20, 0, -12)
    add(p, 'forearmR', -70, 10, 0)
    add(p, 'handR', -10, 0, 0)
    return p


def _strafe(t, d):
    p = {}
    ph = TAU * t
    s, c = sin(ph), cos(ph)
    add(p, 'thighL', -8, 0, d * 24 * s)
    add(p, 'thighR', -8, 0, -d * 24 * s)
    add(p, 'shinL', 18 + 60 * max(0.0, c) ** 1.4)
    add(p, 'shinR', 18 + 60 * max(0.0, -c) ** 1.4)
    add(p, 'footL', 0, 0, -d * 18 * s)
    add(p, 'footR', 0, 0, d * 18 * s)
    add(p, 'thighL', -18 * max(0.0, c), 0, 0)
    add(p, 'thighR', -18 * max(0.0, -c), 0, 0)
    addloc(p, 'hips', 0, -0.06 - 0.03 * cos(2 * ph), 0)
    add(p, 'hips', 0, d * 8, -d * 4 * sin(2 * ph))
    add(p, 'spine', 8, -d * 8, d * 3)
    aim_upper(p)
    return p


def StrafeL(t):
    return _strafe(t, 1)


def StrafeR(t):
    return _strafe(t, -1)


def RunBack(t):
    p = {}
    ph = TAU * t
    s, c = sin(ph), cos(ph)
    add(p, 'thighL', 28 * s - 10, 0, 0)
    add(p, 'thighR', -28 * s - 10, 0, 0)
    add(p, 'shinL', 20 + 70 * max(0.0, -c) ** 1.4)
    add(p, 'shinR', 20 + 70 * max(0.0, c) ** 1.4)
    add(p, 'footL', 10 * max(0.0, s))
    add(p, 'footR', 10 * max(0.0, -s))
    addloc(p, 'hips', 0, -0.06 - 0.03 * cos(2 * ph), 0)
    add(p, 'hips', 0, 6 * s, 0)
    add(p, 'spine', 2, 0, 0)
    aim_upper(p)
    return p


def Fall(t):
    p = {}
    ph = TAU * t
    add(p, 'spine', -6 + 2 * sin(ph), 0, 0)
    add(p, 'chest', -4, 6, 0)
    add(p, 'head', 6, 0, 0)
    add(p, 'thighL', -34 + 8 * sin(ph), 0, 6)
    add(p, 'shinL', 48 + 8 * sin(ph + 1))
    add(p, 'footL', 18)
    add(p, 'thighR', 8 - 8 * sin(ph), 0, -6)
    add(p, 'shinR', 66 - 8 * sin(ph + 1))
    add(p, 'footR', 25)
    add(p, 'upperarmL', -35 + 10 * sin(ph * 2), 0, 52 + 6 * sin(ph))
    add(p, 'forearmL', -30, 0, 0)
    add(p, 'handL', 0, 0, 10)
    add(p, 'upperarmR', -52, 0, -28 - 5 * sin(ph))
    add(p, 'forearmR', -30, 12, 0)
    return p


def JumpUp(t):
    p = Fall(0.0)
    k = bump(t, 0.0, 0.35, 1.0)
    e = seg(t, 0, 0.4)
    add(p, 'thighL', -30 * k, 0, 0)
    add(p, 'shinL', 50 * k)
    add(p, 'thighR', 25 * (1 - e), 0, 0)
    add(p, 'shinR', -30 * (1 - e))
    add(p, 'footR', 30 * (1 - e))
    add(p, 'upperarmL', -60 * k, 0, 0)
    add(p, 'spine', 8 * (1 - e), 0, 0)
    return p


def DoubleJump(t):
    """Tucked front flip."""
    p = {}
    tuck = bump(t, 0.0, 0.25, 1.0)
    rot = sm(lin(t, 0.05, 0.85)) * 360
    add(p, 'hips', rot, 0, 0)
    addloc(p, 'hips', 0, 0.28 * sin(math.pi * lin(t, 0.05, 0.9)), 0)
    add(p, 'spine', 35 * tuck, 0, 0)
    add(p, 'chest', 20 * tuck, 0, 0)
    add(p, 'head', 20 * tuck, 0, 0)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -115 * tuck, 0, (6 if s == 'L' else -6) * tuck)
        add(p, 'shin' + s, 135 * tuck)
        add(p, 'foot' + s, 30 * tuck)
    add(p, 'upperarmL', -70 * tuck, 0, 20 * tuck)
    add(p, 'forearmL', -70 * tuck, 0, 0)
    add(p, 'upperarmR', -40 * tuck, 0, -30 * tuck)
    add(p, 'forearmR', -80 * tuck, 20 * tuck, 0)
    # finish into the Fall pose
    return blend(p, Fall(0), seg(t, 0.8, 1.0))


def Land(t):
    p = {}
    stand(p)
    gun_low(p)
    k = bump(t, 0.0, 0.18, 1.0)
    addloc(p, 'hips', 0, -0.22 * k, 0)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -45 * k, 0, 0)
        add(p, 'shin' + s, 88 * k)
        add(p, 'foot' + s, -43 * k)
    add(p, 'spine', 24 * k, 0, 0)
    add(p, 'chest', 8 * k, 0, 0)
    add(p, 'head', -18 * k, 0, 0)
    add(p, 'upperarmL', -10 * k, 0, 25 * k)
    add(p, 'upperarmR', 0, 0, -12 * k)
    return p


def RollLand(t):
    p = {}
    curl = bump(t, 0.0, 0.3, 1.0)
    rot = sm(lin(t, 0.08, 0.85)) * 360
    add(p, 'hips', rot, 0, 0)
    addloc(p, 'hips', 0, -0.55 * sin(math.pi * lin(t, 0.0, 0.95)), 0)
    add(p, 'spine', 45 * curl, 0, 0)
    add(p, 'chest', 30 * curl, 0, 0)
    add(p, 'head', 30 * curl, 0, 0)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -120 * curl, 0, 0)
        add(p, 'shin' + s, 140 * curl)
    add(p, 'upperarmL', -90 * curl, 0, 10)
    add(p, 'forearmL', -60 * curl)
    add(p, 'upperarmR', -60 * curl, 0, -20 * curl)
    add(p, 'forearmR', -90 * curl, 15, 0)
    q = {}
    stand(q)
    gun_low(q)
    return blend(p, q, seg(t, 0.8, 1.0))


def Slide(t):
    p = {}
    ph = TAU * t
    addloc(p, 'hips', 0, -0.56, 0)
    add(p, 'hips', -24, 12, 6 + 1.5 * sin(ph))
    add(p, 'thighR', -66, 0, -4)
    add(p, 'shinR', 6)
    add(p, 'footR', -12)
    add(p, 'thighL', -22, 0, 18)
    add(p, 'shinL', 118)
    add(p, 'footL', 22)
    add(p, 'spine', 14, -6, 0)
    add(p, 'chest', 10, -6, 0)
    add(p, 'head', -8, 0, 0)
    add(p, 'upperarmL', 38, 0, 34)
    add(p, 'forearmL', -8, 0, 0)
    add(p, 'handL', 30, 0, 0)
    gun_low(p)
    add(p, 'upperarmR', -30, 0, 0)
    return p


def _wallrun(t, d):
    """d = +1 wall on the left (+X), -1 wall on the right."""
    p = {}
    ph = TAU * t
    run_legs(p, ph, stride=46, knee=95, lean=10, bounce=0.6)
    add(p, 'thighL', 0, 0, d * 16)
    add(p, 'thighR', 0, 0, d * 16)
    add(p, 'hips', 0, 0, -d * 6)
    add(p, 'spine', 0, 0, -d * 6)
    add(p, 'head', 0, 0, d * 10)
    if d > 0:  # left hand brushes the wall
        add(p, 'upperarmL', -40 + 8 * sin(ph), 0, 78)
        add(p, 'forearmL', -20, 0, 0)
        add(p, 'handL', 0, 0, 40)
        gun_run(p, ph)
    else:
        run_left_arm(p, ph, 30)
        add(p, 'upperarmR', -55, 0, -70)
        add(p, 'forearmR', -35, 0, 0)
    return p


def WallRunL(t):
    return _wallrun(t, 1)


def WallRunR(t):
    return _wallrun(t, -1)


def WallJump(t):
    p = Fall(0.0)
    k = bump(t, 0.0, 0.25, 1.0)
    add(p, 'thighL', 30 * k, 0, 0)
    add(p, 'shinL', -40 * k)
    add(p, 'thighR', -70 * k, 0, 0)
    add(p, 'shinR', 50 * k)
    add(p, 'spine', -12 * k, 0, 0)
    add(p, 'chest', 0, 25 * k, 0)
    add(p, 'upperarmL', -60 * k, 0, 20 * k)
    return p


def Mantle(t):
    """Hands reach the ledge, body is hauled up, knees tuck onto it, stand."""
    p = {}
    reach = 1 - seg(t, 0.25, 0.6)
    push = bump(t, 0.2, 0.55, 0.95)
    tuck = bump(t, 0.3, 0.6, 1.0)
    for s, sgn in (('L', 1), ('R', -1)):
        add(p, 'upperarm' + s, -165 * reach - 20 * (1 - reach), -sgn * 10 * reach, sgn * (15 * reach + 12 * push))
        add(p, 'forearm' + s, -25 * reach - 70 * push, 0, 0)
    add(p, 'handR', -20 * reach, 0, 0)
    add(p, 'spine', 10 + 25 * push, 0, 0)
    add(p, 'chest', 5 + 10 * push, 0, 0)
    add(p, 'head', -15 * push, 0, 0)
    add(p, 'thighL', -100 * tuck - 10 * reach, 0, 0)
    add(p, 'shinL', 125 * tuck + 20 * reach)
    add(p, 'thighR', -60 * tuck + 15 * reach, 0, 0)
    add(p, 'shinR', 95 * tuck + 30 * reach)
    add(p, 'footL', 20 * reach)
    add(p, 'footR', 25 * reach)
    addloc(p, 'hips', 0, -0.25 * tuck, 0)
    q = {}
    stand(q)
    gun_low(q)
    return blend(p, q, seg(t, 0.85, 1.0))


def Vault(t):
    """Speed vault: left hand plants, legs swing through to the right."""
    p = {}
    k = bump(t, 0.0, 0.45, 1.0)
    plant = bump(t, 0.1, 0.35, 0.75)
    add(p, 'hips', -10 * k, 0, 32 * k)
    addloc(p, 'hips', -0.1 * k, 0.1 * k, 0)
    add(p, 'spine', 20 * k, 0, 14 * k)
    add(p, 'chest', 10 * k, 20 * k, 0)
    add(p, 'head', -10 * k, 0, -26 * k)
    add(p, 'upperarmL', -45 * plant, 0, 12 * plant)
    add(p, 'forearmL', -5 * plant)
    add(p, 'handL', 60 * plant, 0, 0)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -80 * k, 0, -34 * k)
        add(p, 'shin' + s, 40 * k)
        add(p, 'foot' + s, 10 * k)
    gun_run(p, 0)
    add(p, 'upperarmR', 0, 0, -30 * k)
    q = Run(0.25)
    return blend(p, q, seg(t, 0.85, 1.0))


def Dash(t):
    p = {}
    k = bump(t, 0.0, 0.2, 1.0)
    add(p, 'spine', 30 * k, 0, 0)
    add(p, 'chest', 10 * k, 0, 0)
    add(p, 'head', -30 * k, 0, 0)
    add(p, 'thighL', 35 * k, 0, 0)
    add(p, 'shinL', 70 * k)
    add(p, 'footL', 40 * k)
    add(p, 'thighR', -30 * k, 0, 0)
    add(p, 'shinR', 50 * k)
    add(p, 'upperarmL', 60 * k, 0, 15 * k)
    add(p, 'forearmL', -20 * k)
    gun_run(p, 0)
    add(p, 'upperarmR', 20 * k, 0, 0)
    addloc(p, 'hips', 0, -0.08 * k, 0)
    return blend(p, Run(0.0), seg(t, 0.75, 1.0))


def Grind(t):
    p = {}
    ph = TAU * t
    addloc(p, 'hips', 0, -0.17 + 0.012 * sin(2 * ph), 0)
    add(p, 'hips', 0, 58, 4 * sin(ph))
    add(p, 'spine', 10, -24, -3 * sin(ph))
    add(p, 'chest', 4, -22, 0)
    add(p, 'head', -6, -10, 0)
    add(p, 'thighL', -34, 0, 12)
    add(p, 'shinL', 50)
    add(p, 'footL', -16, 0, -10)
    add(p, 'thighR', 14, 0, -14)
    add(p, 'shinR', 44)
    add(p, 'footR', -30, 0, 12)
    add(p, 'upperarmL', -10, 0, 72 + 8 * sin(ph))
    add(p, 'forearmL', -18 + 6 * sin(ph + 1), 0, 0)
    add(p, 'upperarmR', -40, 0, -48 - 6 * sin(ph))
    add(p, 'forearmR', -40, 0, 0)
    return p


def PoundStart(t):
    """Front flip into a downward slam."""
    p = {}
    rot = sm(lin(t, 0.0, 0.8)) * 360
    tuck = bump(t, 0.0, 0.35, 1.0)
    add(p, 'hips', rot, 0, 0)
    addloc(p, 'hips', 0, 0.2 * sin(math.pi * t), 0)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -110 * tuck, 0, 0)
        add(p, 'shin' + s, 130 * tuck)
    add(p, 'spine', 30 * tuck, 0, 0)
    add(p, 'upperarmL', -80 * tuck, 0, 20)
    add(p, 'forearmL', -60 * tuck)
    add(p, 'upperarmR', -60 * tuck, 0, -20)
    add(p, 'forearmR', -80 * tuck)
    return blend(p, PoundFall(0), seg(t, 0.8, 1.0))


def PoundFall(t):
    p = {}
    add(p, 'spine', 10, 0, 0)
    add(p, 'head', -10, 0, 0)
    add(p, 'thighL', -70, 0, 0)
    add(p, 'shinL', 100)
    add(p, 'thighR', -10, 0, 0)
    add(p, 'shinR', 60)
    add(p, 'upperarmL', -150, 0, 30 + 4 * sin(TAU * t))
    add(p, 'forearmL', -20)
    add(p, 'upperarmR', -150, 0, -30)
    add(p, 'forearmR', -20)
    return p


def PoundLand(t):
    """Superhero landing: one knee down, left fist to the ground, then rise."""
    p = {}
    k = 1 - seg(t, 0.45, 1.0)
    addloc(p, 'hips', 0, -0.46 * k, 0)
    add(p, 'thighL', -85 * k, 0, 6 * k)
    add(p, 'shinL', 95 * k)
    add(p, 'footL', -10 * k)
    add(p, 'thighR', 25 * k, 0, -6 * k)
    add(p, 'shinR', 110 * k)
    add(p, 'footR', 40 * k)
    add(p, 'spine', 32 * k, 0, 0)
    add(p, 'chest', 10 * k, 10 * k, 0)
    add(p, 'head', -30 * k, 0, 0)
    add(p, 'upperarmL', -30 * k, 0, 16 * k)
    add(p, 'forearmL', -5 * k)
    add(p, 'upperarmR', -20 * k, 0, -40 * k)
    add(p, 'forearmR', -40 * k)
    q = {}
    stand(q)
    gun_low(q)
    return blend(p, q, 1 - k)


def Bounce(t):
    """Launched off the bed: star-jump spread."""
    p = {}
    k = bump(t, 0.0, 0.35, 1.0)
    add(p, 'upperarmL', -20 * k, 0, 120 * k)
    add(p, 'upperarmR', -20 * k, 0, -100 * k)
    add(p, 'thighL', 0, 0, 30 * k)
    add(p, 'thighR', 0, 0, -30 * k)
    add(p, 'spine', -12 * k, 0, 0)
    add(p, 'head', 15 * k, 0, 0)
    return blend(p, Fall(0), seg(t, 0.7, 1.0))


def Hit(t):
    p = {}
    stand(p)
    gun_low(p)
    k = bump(t, 0.0, 0.15, 1.0)
    add(p, 'spine', -16 * k, 0, 5 * k)
    add(p, 'chest', -8 * k, -10 * k, 0)
    add(p, 'head', -14 * k, 0, 8 * k)
    add(p, 'upperarmL', -20 * k, 0, 30 * k)
    addloc(p, 'hips', 0, -0.05 * k, 0)
    return p


def Wake(t):
    """Death: the figment crumples backward as the dreamer wakes."""
    p = {}
    buckle = seg(t, 0.0, 0.35)
    fall = seg(t, 0.25, 0.8)
    addloc(p, 'hips', 0, -0.35 * buckle - 0.5 * fall, -0.25 * fall)
    add(p, 'hips', -85 * fall, 0, 8 * fall)
    for s in ('L', 'R'):
        add(p, 'thigh' + s, -50 * buckle + 30 * fall, 0, 0)
        add(p, 'shin' + s, 90 * buckle - 40 * fall)
    add(p, 'spine', 20 * buckle - 25 * fall, 0, 0)
    add(p, 'head', 20 * buckle - 30 * fall, 20 * fall, 0)
    add(p, 'upperarmL', -60 * fall, 0, 60 * fall)
    add(p, 'upperarmR', -80 * fall, 0, -50 * fall)
    add(p, 'forearmR', -30 * fall)
    return p


# ---------------------------------------------------------------------------
# Upper-body overlays (the lower body in these clips is a neutral stance;
# the game only uses their UPPER tracks)
# ---------------------------------------------------------------------------
def AimIdle(t):
    p = {}
    stand(p)
    aim_upper(p)
    add(p, 'chest', 1.0 * sin(TAU * t), 0, 0)
    add(p, 'upperarmR', 0.6 * sin(TAU * t + 1), 0, 0)
    return p


def _kick(t, dur, rise=0.05, decay=10.0):
    s = t * dur
    return s / rise if s < rise else math.exp(-(s - rise) * decay)


def FireRound(t):
    p = AimIdle(0)
    k = _kick(t, 0.22, 0.03, 16)
    add(p, 'upperarmR', -10 * k, 0, 0)
    add(p, 'forearmR', -6 * k, 0, 0)
    add(p, 'handR', -22 * k, 0, 0)
    add(p, 'upperarmL', -4 * k, 0, 0)
    add(p, 'chest', -4 * k, 2 * k, 0)
    add(p, 'gunHammer', 35 * (1 - seg(t, 0.0, 0.1)) * seg(t, 0.0, 0.02) + 35 * seg(t, 0.5, 1.0) * 0, 0, 0)
    add(p, 'gunCylinder', 0, 60 * seg(t, 0.05, 0.6), 0)
    return p


def Give(t):
    p = AimIdle(0)
    k = _kick(t, 0.4, 0.04, 9)
    add(p, 'upperarmR', -16 * k, 0, 0)
    add(p, 'handR', -30 * k, 0, 0)
    add(p, 'upperarmL', -8 * k, 0, 0)
    add(p, 'chest', -7 * k, 5 * k, 0)
    add(p, 'head', -4 * k, 0, 0)
    add(p, 'gunBreak', 12 * bump(t, 0.0, 0.1, 0.5), 0, 0)
    add(p, 'gunVial', 0, 0, 180 * seg(t, 0.1, 0.7))
    return p


def Take(t):
    """Thrust at the target, then yank the property back toward the chest."""
    p = AimIdle(0)
    thrust = bump(t, 0.0, 0.15, 0.4)
    pull = bump(t, 0.3, 0.55, 1.0)
    add(p, 'upperarmR', -6 * thrust + 26 * pull, 0, 0)
    add(p, 'forearmR', -34 * pull, 10 * pull, 0)
    add(p, 'handR', 10 * pull, 0, 0)
    add(p, 'chest', 6 * thrust - 8 * pull, -10 * pull, 0)
    add(p, 'upperarmL', 18 * pull, 0, 0)
    add(p, 'forearmL', -20 * pull, 0, 0)
    p['gunVial@loc'] = (0, 0, 0.035 * bump(t, 0.4, 0.6, 0.9))
    add(p, 'gunVial', 0, 0, 360 * seg(t, 0.45, 0.95))
    return p


def Reload(t):
    """Tip the gun, break it open, spin the cylinder, flick it shut."""
    p = AimIdle(0)
    bring = seg(t, 0.0, 0.16) * (1 - seg(t, 0.84, 1.0))
    open_ = seg(t, 0.12, 0.26) * (1 - seg(t, 0.68, 0.76))
    swipe = bump(t, 0.3, 0.42, 0.6)
    flick = bump(t, 0.66, 0.72, 0.86)
    add(p, 'upperarmR', 36 * bring - 18 * flick, 20 * bring, 10 * bring)
    add(p, 'forearmR', -38 * bring, 10 * bring, 0)
    add(p, 'handR', 10 * bring - 35 * flick, 0, 65 * bring)
    add(p, 'chest', 6 * bring, -8 * bring, 0)
    add(p, 'head', 14 * bring, -10 * bring, 0)
    add(p, 'upperarmL', 22 * bring - 10 * swipe, 20 * bring, 0)
    add(p, 'forearmL', -30 * bring - 20 * swipe, 0, 0)
    add(p, 'handL', 0, 0, -25 * swipe)
    add(p, 'gunBreak', 58 * open_, 0, 0)
    add(p, 'gunCylinder', 0, 720 * seg(t, 0.36, 0.72), 0)
    add(p, 'gunHammer', 30 * bump(t, 0.8, 0.86, 0.98), 0, 0)
    return p


def SwapProperty(t):
    p = AimIdle(0)
    tilt = bump(t, 0.0, 0.25, 1.0)
    add(p, 'upperarmR', 20 * tilt, 10 * tilt, 0)
    add(p, 'forearmR', -20 * tilt, 0, 0)
    add(p, 'handR', 0, 0, 40 * tilt)
    add(p, 'upperarmL', 10 * tilt, 0, 0)
    add(p, 'forearmL', -25 * bump(t, 0.35, 0.5, 0.7), 0, 0)
    p['gunVial@loc'] = (0, 0, 0.06 * bump(t, 0.1, 0.35, 0.75))
    add(p, 'gunVial', 0, 0, 360 * seg(t, 0.15, 0.7))
    return p


def Infuse(t):
    """Press the give barrel to your own chest; the vial drains into you."""
    p = AimIdle(0)
    k = bump(t, 0.0, 0.3, 1.0)
    add(p, 'chest', 10 * k, -14 * k, 0)
    add(p, 'head', 20 * k, 0, 0)
    add(p, 'upperarmR', 45 * k, 35 * k, 0)
    add(p, 'forearmR', -65 * k, 40 * k, 0)
    add(p, 'handR', 0, 0, 30 * k)
    add(p, 'upperarmL', 30 * k, 20 * k, 0)
    add(p, 'forearmL', -40 * k, 0, 0)
    add(p, 'gunVial', 0, 0, 540 * seg(t, 0.25, 0.85))
    add(p, 'gunCylinder', 0, 360 * seg(t, 0.3, 0.8), 0)
    return p


# ---------------------------------------------------------------------------
# Melee, deflect, deathblow, focus (v2 combat)
# The palette-knife bayonet unfolds from under the give barrel for these.
# ---------------------------------------------------------------------------
def blade_open(p, t, a=0.0, b=0.08):
    p['gunBlade'] = (178 * (1 - seg(t, a, b)), 0, 0)


def lerp3(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def Slash1(t):
    """Forehand: wind up to the right, sweep across to the left."""
    p = AimIdle(0)
    blade_open(p, t)
    wind = seg(t, 0.0, 0.2)
    hit = seg(t, 0.2, 0.46)
    back = seg(t, 0.62, 1.0)
    ua = lerp3(lerp3((-86, -16, -4), (-78, -58, -12), wind), (-96, 72, 4), hit)
    ua = lerp3(ua, (-88, 30, 0), back * 0.5)
    p['upperarmR'] = ua
    p['forearmR'] = lerp3(lerp3((-4, 0, 0), (-32, 0, 0), wind), (-4, 0, 0), hit)
    p['handR'] = (-6 * hit, 0, 0)
    p['chest'] = lerp3(lerp3((3, 18, 0), (2, -30, 0), wind), (6, 40, -4), hit)
    p['head'] = lerp3((2, -10, 0), (4, -24, 0), hit)
    p['upperarmL'] = lerp3((-58, -48, 8), (-18, 10, 42), hit)
    p['forearmL'] = lerp3((-52, 0, 0), (-38, 0, 0), hit)
    return p


def Slash2(t):
    """Backhand: from across the body, rising out to the right."""
    p = AimIdle(0)
    p['gunBlade'] = (0, 0, 0)
    wind = seg(t, 0.0, 0.18)
    hit = seg(t, 0.18, 0.44)
    p['upperarmR'] = lerp3(lerp3((-96, 72, 4), (-66, 82, 14), wind), (-106, -62, -14), hit)
    p['forearmR'] = lerp3(lerp3((-4, 0, 0), (-66, 0, 0), wind), (-6, 0, 0), hit)
    p['handR'] = (0, 0, 0)
    p['chest'] = lerp3(lerp3((6, 40, -4), (4, 44, 0), wind), (4, -34, 4), hit)
    p['head'] = lerp3((4, -24, 0), (2, 20, 0), hit)
    p['upperarmL'] = lerp3((-18, 10, 42), (-10, -10, 55), hit)
    p['forearmL'] = (-35, 0, 0)
    return p


def Slash3(t):
    """Two-handed overhead chop: the finisher of the combo."""
    p = AimIdle(0)
    p['gunBlade'] = (0, 0, 0)
    up = seg(t, 0.0, 0.3)
    chop = seg(t, 0.36, 0.56)
    rec = seg(t, 0.7, 1.0)
    p['upperarmR'] = lerp3(lerp3((-106, -62, -14), (-172, 8, 0), up), (-38, 6, 0), chop)
    p['upperarmR'] = lerp3(p['upperarmR'], (-80, -10, 0), rec * 0.6)
    p['forearmR'] = lerp3(lerp3((-6, 0, 0), (-48, 0, 0), up), (-8, 0, 0), chop)
    p['upperarmL'] = lerp3(lerp3((-10, -10, 55), (-160, -30, 0), up), (-44, -32, 0), chop)
    p['forearmL'] = lerp3(lerp3((-35, 0, 0), (-50, 0, 0), up), (-18, 0, 0), chop)
    p['chest'] = lerp3(lerp3((4, -34, 4), (-14, 8, 0), up), (24, 6, 0), chop)
    p['head'] = lerp3((2, 0, 0), (-12, 0, 0), chop)
    return p


def DownStrike(t):
    """Airborne pogo strike: blade straight down beneath the feet."""
    p = {}
    k = seg(t, 0.0, 0.18)
    p['gunBlade'] = (178 * (1 - seg(t, 0.0, 0.1)), 0, 0)
    add(p, 'hips', 22 * k, 0, 0)
    addloc(p, 'hips', 0, 0.12 * k, 0)
    add(p, 'spine', 14 * k, 0, 0)
    add(p, 'chest', 10 * k, 0, 0)
    add(p, 'head', 22 * k, 0, 0)
    for s, sg in (('L', 1), ('R', -1)):
        add(p, 'thigh' + s, -72 * k, 0, sg * 12 * k)
        add(p, 'shin' + s, 104 * k)
        add(p, 'foot' + s, 20 * k)
    add(p, 'upperarmR', -46 * k, 0, -8 * k)
    add(p, 'forearmR', 0)
    add(p, 'upperarmL', -30 * k, 0, 72 * k)
    add(p, 'forearmL', -20 * k)
    return p


def _guard(p, w=1.0):
    p['gunBlade'] = (0, 0, 0)
    p['upperarmR'] = lerp3(p.get('upperarmR', (0, 0, 0)), (-62, 34, 0), w)
    p['forearmR'] = lerp3(p.get('forearmR', (0, 0, 0)), (-98, 0, 0), w)
    p['handR'] = lerp3(p.get('handR', (0, 0, 0)), (0, 0, 28), w)
    p['upperarmL'] = lerp3(p.get('upperarmL', (0, 0, 0)), (-74, -44, 0), w)
    p['forearmL'] = lerp3(p.get('forearmL', (0, 0, 0)), (-78, 0, 0), w)
    p['chest'] = lerp3(p.get('chest', (0, 0, 0)), (6, 22, 0), w)
    p['head'] = lerp3(p.get('head', (0, 0, 0)), (6, -14, 0), w)


def Deflect(t):
    """Snap the gun up across the face: the perfect-deflect window."""
    p = AimIdle(0)
    _guard(p, seg(t, 0.0, 0.25))
    k = bump(t, 0.25, 0.4, 1.0)
    add(p, 'upperarmR', 8 * k, 0, 0)
    add(p, 'chest', -5 * k, 0, 0)
    return p


def Guard(t):
    p = AimIdle(0)
    _guard(p)
    add(p, 'chest', 1.2 * sin(TAU * t), 0, 0)
    add(p, 'upperarmR', 1.5 * sin(TAU * t + 1), 0, 0)
    return p


def DeflectHit(t):
    """Something struck the guard: arms driven back, then recover."""
    p = AimIdle(0)
    _guard(p)
    k = _kick(t, 0.28, 0.03, 12)
    add(p, 'upperarmR', 22 * k, -10 * k, 0)
    add(p, 'forearmR', 16 * k)
    add(p, 'upperarmL', 18 * k, 8 * k, 0)
    add(p, 'chest', -12 * k, -8 * k, 0)
    add(p, 'head', -10 * k, 0, 0)
    return p


def Deathblow(t):
    """Lunge, drive the blade in, twist, rip it back out."""
    p = {}
    p['gunBlade'] = (0, 0, 0)
    lunge = seg(t, 0.0, 0.2)
    twist = seg(t, 0.32, 0.48)
    rip = seg(t, 0.48, 0.66)
    rec = seg(t, 0.78, 1.0)
    L = lunge * (1 - rec)
    addloc(p, 'hips', 0, -0.26 * L, 0.05 * L)
    add(p, 'hips', 10 * L, 12 * L, 0)
    add(p, 'thighL', -66 * L, 0, 6 * L)
    add(p, 'shinL', 72 * L)
    add(p, 'footL', -6 * L)
    add(p, 'thighR', 34 * L, 0, -4 * L)
    add(p, 'shinR', 18 * L)
    add(p, 'footR', 24 * L)
    add(p, 'spine', 14 * L, 0, 0)
    ua = lerp3((-18, 0, -9), (-90, 4, 0), lunge)
    ua = lerp3(ua, (-44, -34, -6), rip)
    p['upperarmR'] = lerp3(ua, (-18, 0, -9), rec)
    fa = lerp3((-38, 12, 0), (0, 0, 0), lunge)
    fa = lerp3(fa, (-64, 0, 0), rip)
    p['forearmR'] = lerp3(fa, (-38, 12, 0), rec)
    p['handR'] = (0, 88 * twist * (1 - rec), 0)
    p['chest'] = lerp3(lerp3((0, 0, 0), (8, 30, 0), lunge), (4, -22, 0), rip)
    p['chest'] = lerp3(p['chest'], (2, 6, 0), rec)
    p['upperarmL'] = lerp3(lerp3((4, 0, 8), (-84, -24, 0), lunge), (-96, 4, 0), rip)
    p['upperarmL'] = lerp3(p['upperarmL'], (4, 0, 8), rec)
    p['forearmL'] = lerp3((-18, 0, 0), (-8, 0, 0), lunge)
    p['head'] = lerp3((0, 0, 0), (-6, -20, 0), lunge)
    q = {}
    stand(q)
    return blend(p, blend(p, q, 0), 0) if rec < 1 else blend(p, q, 1)


def Focus(t):
    """Kneel, blade planted, the apple cupped in the left hand: healing."""
    p = {}
    ph = TAU * t
    b = sin(ph) * 0.5 + 0.5
    p['gunBlade'] = (0, 0, 0)
    addloc(p, 'hips', 0, -0.46 - 0.01 * b, 0)
    add(p, 'thighL', -92, 0, 8)
    add(p, 'shinL', 92)
    add(p, 'footL', -2)
    add(p, 'thighR', 12, 0, -6)
    add(p, 'shinR', 104)
    add(p, 'footR', 44)
    add(p, 'spine', 14 + 2 * b, 0, 0)
    add(p, 'chest', 8 + 2 * b, 0, 0)
    add(p, 'neck', 10, 0, 0)
    add(p, 'head', 18 - 3 * b, 0, 0)
    add(p, 'upperarmL', -58, -22, 6)
    add(p, 'forearmL', -96, 0, 0)
    add(p, 'handL', 0, 0, 30)
    add(p, 'upperarmR', -8, 0, -18)
    add(p, 'forearmR', -24, 0, 0)
    add(p, 'handR', 30, 0, 0)
    return p


def Stagger(t):
    """Knocked off balance by a crushing blow."""
    p = {}
    stand(p)
    gun_low(p)
    k = bump(t, 0.0, 0.18, 1.0)
    addloc(p, 'hips', 0, -0.12 * k, -0.08 * k)
    add(p, 'hips', -10 * k, 0, 6 * k)
    add(p, 'spine', -18 * k, 0, 0)
    add(p, 'chest', -14 * k, -12 * k, 0)
    add(p, 'head', -22 * k, 10 * k, 0)
    add(p, 'thighR', 30 * k, 0, 0)
    add(p, 'shinR', 30 * k)
    add(p, 'thighL', -18 * k, 0, 0)
    add(p, 'shinL', 40 * k)
    add(p, 'upperarmL', -40 * k, 0, 60 * k)
    add(p, 'upperarmR', -30 * k, 0, -50 * k)
    return p


# name: (fn, seconds, loop)
CLIPS = {
    'Idle': (Idle, 3.0, True),
    'Run': (Run, 0.62, True),
    'Sprint': (Sprint, 0.54, True),
    'StrafeL': (StrafeL, 0.6, True),
    'StrafeR': (StrafeR, 0.6, True),
    'RunBack': (RunBack, 0.66, True),
    'Fall': (Fall, 1.2, True),
    'JumpUp': (JumpUp, 0.35, False),
    'DoubleJump': (DoubleJump, 0.6, False),
    'Land': (Land, 0.32, False),
    'RollLand': (RollLand, 0.7, False),
    'Slide': (Slide, 1.0, True),
    'WallRunL': (WallRunL, 0.5, True),
    'WallRunR': (WallRunR, 0.5, True),
    'WallJump': (WallJump, 0.4, False),
    'Mantle': (Mantle, 0.6, False),
    'Vault': (Vault, 0.5, False),
    'Dash': (Dash, 0.32, False),
    'Grind': (Grind, 1.2, True),
    'PoundStart': (PoundStart, 0.34, False),
    'PoundFall': (PoundFall, 0.6, True),
    'PoundLand': (PoundLand, 0.7, False),
    'Bounce': (Bounce, 0.6, False),
    'Hit': (Hit, 0.3, False),
    'Wake': (Wake, 1.4, False),
    'AimIdle': (AimIdle, 2.0, True),
    'FireRound': (FireRound, 0.22, False),
    'Give': (Give, 0.4, False),
    'Take': (Take, 0.55, False),
    'Reload': (Reload, 1.1, False),
    'SwapProperty': (SwapProperty, 0.45, False),
    'Infuse': (Infuse, 0.7, False),
    'Slash1': (Slash1, 0.36, False),
    'Slash2': (Slash2, 0.36, False),
    'Slash3': (Slash3, 0.52, False),
    'DownStrike': (DownStrike, 0.5, True),
    'Deflect': (Deflect, 0.3, False),
    'Guard': (Guard, 1.2, True),
    'DeflectHit': (DeflectHit, 0.28, False),
    'Deathblow': (Deathblow, 0.9, False),
    'Focus': (Focus, 1.4, True),
    'Stagger': (Stagger, 0.6, False),
}

# poses rendered by --preview: (clip, t)
PREVIEW = [('Idle', 0.0), ('Run', 0.0), ('Run', 0.25), ('Run', 0.5), ('Sprint', 0.25), ('StrafeL', 0.25),
           ('Fall', 0.0), ('DoubleJump', 0.3), ('DoubleJump', 0.5), ('Land', 0.18), ('Slide', 0.0),
           ('WallRunL', 0.25), ('Mantle', 0.1), ('Mantle', 0.55), ('Vault', 0.4), ('Dash', 0.2), ('Grind', 0.0),
           ('PoundLand', 0.1), ('AimIdle', 0.0), ('Reload', 0.2), ('Reload', 0.45), ('Take', 0.5),
           ('SwapProperty', 0.35), ('Infuse', 0.3)]

PREVIEW_GUN = [('AimIdle', 0.0), ('Reload', 0.3), ('Reload', 0.5), ('FireRound', 0.1),
               ('Take', 0.6), ('SwapProperty', 0.3), ('Give', 0.1), ('Infuse', 0.3)]

PREVIEW_COMBAT = [('Slash1', 0.1), ('Slash1', 0.45), ('Slash2', 0.1), ('Slash2', 0.45), ('Slash3', 0.25), ('Slash3', 0.56),
                  ('DownStrike', 0.5), ('Deflect', 0.3), ('Guard', 0.0), ('Deathblow', 0.25), ('Deathblow', 0.55), ('Focus', 0.2)]
