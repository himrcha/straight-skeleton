import {Skeleton, SkeletonBuilder} from '../wrapper';
import {isPolygon} from "geojson-validation";
import earcut from "earcut";
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';

const samples: GeoJSON.Polygon[] = [];

let activeSkeleton: Skeleton = null;
let skeletonBox: {minX: number, minY: number, maxX: number, maxY: number} = null;

const updateSkeletonBox = () => {
	if (activeSkeleton === null) {
		skeletonBox = null;
		return;
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const vertex of activeSkeleton.vertices) {
		minX = Math.min(minX, vertex[0]);
		minY = Math.min(minY, vertex[1]);
		maxX = Math.max(maxX, vertex[0]);
		maxY = Math.max(maxY, vertex[1]);

	}

	skeletonBox = {minX, minY, maxX, maxY};
};

SkeletonBuilder.init().then(() => {
	// 2D canvas

	const canvas2d = document.getElementById('canvas2d') as HTMLCanvasElement;
	const ctx = canvas2d.getContext('2d');

	const draw2d = () => {
		ctx.fillStyle = '#eee';
		ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);

		if (activeSkeleton === null) {
			return;
		}

		const padding = 15 * window.devicePixelRatio;
		const scale = Math.min(
			(canvas2d.width - padding * 2) / (skeletonBox.maxX - skeletonBox.minX),
			(canvas2d.height - padding * 2) / (skeletonBox.maxY - skeletonBox.minY)
		);
		const offsetX = (canvas2d.width - (skeletonBox.maxX - skeletonBox.minX) * scale) / 2;
		const offsetY = (canvas2d.height - (skeletonBox.maxY - skeletonBox.minY) * scale) / 2;

		ctx.strokeStyle = '#000';
		ctx.lineWidth = window.devicePixelRatio;
		ctx.fillStyle = '#ffb6e9';

		for (const polygon of activeSkeleton.polygons) {
			ctx.beginPath();

			for (let i = 0; i < polygon.length; i++) {
				const vertex = activeSkeleton.vertices[polygon[i]];
				const x = (vertex[0] - skeletonBox.minX) * scale + offsetX;
				const y = (vertex[1] - skeletonBox.minY) * scale + offsetY;

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			ctx.closePath();
			ctx.stroke();
			ctx.fill();
		}
	};

	const onCanvas2dResize = () => {
		canvas2d.width = canvas2d.clientWidth * window.devicePixelRatio;
		canvas2d.height = canvas2d.clientHeight * window.devicePixelRatio;
		draw2d();
	};

	new ResizeObserver(onCanvas2dResize).observe(canvas2d);

	// 3D canvas

	const canvas3d = document.getElementById('canvas3d') as HTMLCanvasElement;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0xeeeeee);
	const camera = new THREE.PerspectiveCamera(25, canvas3d.clientWidth / canvas3d.clientHeight, 0.01, 100);
	const renderer = new THREE.WebGLRenderer({
		canvas: canvas3d,
		antialias: true
	});
	const controls = new OrbitControls(camera, renderer.domElement);
	const light = new THREE.DirectionalLight(0xffffff, 0.5);
	light.position.set(1, 1, -0.5);
	scene.add(light);
	scene.add(new THREE.AmbientLight(0xffffff, 0.5));

	camera.position.set(1, 2, 1);
	controls.update();

	const onCanvas3dResize = () => {
		canvas3d.width = canvas3d.clientWidth * window.devicePixelRatio;
		canvas3d.height = canvas3d.clientHeight * window.devicePixelRatio;

		renderer.setViewport(0, 0, canvas3d.width, canvas3d.height);
		camera.aspect = canvas3d.clientWidth / canvas3d.clientHeight;
		camera.updateProjectionMatrix();
	};

	new ResizeObserver(onCanvas3dResize).observe(canvas3d);

	const material = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color(0xffb6e9),
		side: THREE.DoubleSide,
		flatShading: true
	});
	const parent = new THREE.Object3D();
	scene.add(parent);

	const animate = () => {
		requestAnimationFrame(animate);
		controls.update();
		renderer.render(scene, camera);
	};
	animate();

	const draw3d = () => {
		parent.remove(...parent.children);

		if (activeSkeleton === null) {
			return;
		}

		const offset = new THREE.Vector3(
			-(skeletonBox.maxX + skeletonBox.minX) / 2,
			-(skeletonBox.maxY + skeletonBox.minY) / 2,
			0
		);
		const scale = 1 / Math.max(skeletonBox.maxX - skeletonBox.minX, skeletonBox.maxY - skeletonBox.minY);

		const geometry = new THREE.BufferGeometry();
		const vertices: number[] = [];

		for (const polygon of activeSkeleton.polygons) {
			const polygonVertices: number[] = [];

			for (let i = 0; i < polygon.length; i++) {
				const vertex = activeSkeleton.vertices[polygon[i]];
				polygonVertices.push(
					(vertex[0] + offset.x) * scale,
					(vertex[1] + offset.y) * scale,
					(vertex[2] + offset.z) * scale
				);
			}

			const triangles = earcut(polygonVertices, null, 3);

			for (let i = 0; i < triangles.length / 3; i++) {
				for (let j = 0; j < 3; j++) {
					const index = triangles[i * 3 + j];

					vertices.push(polygonVertices[index * 3], polygonVertices[index * 3 + 1], polygonVertices[index * 3 + 2]);
				}
			}
		}

		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));

		const mesh = new THREE.Mesh(geometry, material);
		mesh.rotation.x = -Math.PI / 2;
		parent.add(mesh);

		camera.position.set(1, 2, 1);
		controls.update();
	};

	// DOM events

	const updateButton = document.getElementById('update');

	updateButton.addEventListener('click', () => {
		let inputJSON: any;

		try {
			inputJSON = JSON.parse((<HTMLTextAreaElement>document.getElementById('input')).value);
		} catch (e) {
			alert(`Invalid JSON: ${e.message}`);
			console.error(e);
			return;
		}

		const isValid = isPolygon(inputJSON);

		if (!isValid) {
			alert('Invalid GeoJSON polygon');
			return;
		}

		let skeleton: Skeleton;
		const startTime = performance.now();

		try {
			skeleton = SkeletonBuilder.buildFromGeoJSONPolygon(inputJSON);
		} catch (e) {
			alert(`Wasm module threw an error: ${e.message}`);
			console.error(e);
			return;
		}

		if (skeleton === null) {
			alert('Wasm module returned null');
			return;
		}

		const endTime = performance.now();

		document.getElementById('time').innerHTML = `${(endTime - startTime).toFixed(2)} ms`;

		activeSkeleton = skeleton;
		updateSkeletonBox();
		draw2d();
		draw3d();
	});

	const sampleButtons = document.getElementsByClassName('sample');

	for (let i = 0; i < sampleButtons.length; i++) {
		sampleButtons[i].addEventListener('click', () => {
			const id = sampleButtons[i].getAttribute('data-sample');
			const input = JSON.stringify(samples[parseInt(id)], null, 4);

			(<HTMLTextAreaElement>document.getElementById('input')).value = input;

			updateButton.click();
		});
	}

	(sampleButtons[0] as HTMLButtonElement).click();
});
