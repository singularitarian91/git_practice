// Third-person follow camera: orbit (right-drag / arrow keys), zoom (wheel),
// smoothing, terrain avoidance and screen shake.
import * as THREE from 'three';
import { clamp } from './noise.js';

export class FollowCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.yaw = 0;             // 0 = camera south of the player, looking north
    this.pitch = 0.74;
    this.distance = 13;
    this.yawGoal = 0;
    this.pitchGoal = 0.74;
    this.distGoal = 13;
    this.minDist = 5;
    this.maxDist = 26;
    this.trauma = 0;
    this.lookHeight = 1.2;
    this._off = new THREE.Vector3();
    this.initialized = false;
  }

  snap(target) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
    this.yaw = this.yawGoal; this.pitch = this.pitchGoal; this.distance = this.distGoal;
    this.initialized = true;
    this.apply(0);
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  handleInput(input, dt) {
    if (input.drag.dx || input.drag.dy) {
      this.yawGoal -= input.drag.dx * 0.006;
      this.pitchGoal = clamp(this.pitchGoal + input.drag.dy * 0.004, 0.22, 1.25);
    }
    if (input.isDown('ArrowLeft')) this.yawGoal += dt * 1.8;
    if (input.isDown('ArrowRight')) this.yawGoal -= dt * 1.8;
    if (input.isDown('ArrowUp')) this.pitchGoal = clamp(this.pitchGoal + dt * 0.9, 0.22, 1.25);
    if (input.isDown('ArrowDown')) this.pitchGoal = clamp(this.pitchGoal - dt * 0.9, 0.22, 1.25);
    if (input.wheel) this.distGoal = clamp(this.distGoal * (1 + input.wheel * 0.09), this.minDist, this.maxDist);
  }

  // Unit vectors on the ground plane for camera-relative movement.
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  update(target, dt) {
    if (!this.initialized) this.snap(target);
    this.target.copy(target);
    const k = 1 - Math.exp(-dt * 9);
    this.smoothTarget.lerp(this.target, k);
    const ka = 1 - Math.exp(-dt * 10);
    this.yaw += (this.yawGoal - this.yaw) * ka;
    this.pitch += (this.pitchGoal - this.pitch) * ka;
    this.distance += (this.distGoal - this.distance) * (1 - Math.exp(-dt * 7));
    this.apply(dt);
  }

  apply(dt) {
    const cam = this.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._off.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    const look = new THREE.Vector3(this.smoothTarget.x, this.smoothTarget.y + this.lookHeight, this.smoothTarget.z);
    cam.position.copy(look).add(this._off);
    // keep above terrain / water along the boom
    const ground = Math.max(this.terrain.heightAt(cam.position.x, cam.position.z), 0) + 0.8;
    if (cam.position.y < ground) cam.position.y = ground;
    // screen shake
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.35;
      const t = performance.now() * 0.05;
      cam.position.x += Math.sin(t * 1.3) * s;
      cam.position.y += Math.sin(t * 1.7 + 1) * s;
      cam.position.z += Math.sin(t * 1.1 + 2) * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    cam.lookAt(look);
  }
}
