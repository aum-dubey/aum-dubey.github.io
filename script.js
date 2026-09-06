const canvas = document.createElement("canvas");
canvas.id = "dot-field";

document.body.prepend(canvas);

const ctx = canvas.getContext("2d");

let width;
let height;
let dots = [];
let mouse = {
    x: -1000,
    y: -1000
};

const spacing = 32;
const interactionRadius = 110;

function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    createDots();
}

function createDots() {
    dots = [];

    for (let y = 0; y < height + spacing; y += spacing) {
        for (let x = 0; x < width + spacing; x += spacing) {

            dots.push({
                baseX: x,
                baseY: y,
                x: x,
                y: y
            });

        }
    }
}

function animate() {

    ctx.clearRect(0, 0, width, height);

    dots.forEach(dot => {

        const dx = mouse.x - dot.baseX;
        const dy = mouse.y - dot.baseY;

        const distance = Math.sqrt(dx * dx + dy * dy);

        let targetX = dot.baseX;
        let targetY = dot.baseY;

        if (distance < interactionRadius) {

            const force =
                (interactionRadius - distance) /
                interactionRadius;

            const angle = Math.atan2(dy, dx);

            const pushStrength = force * 28;

            targetX =
                dot.baseX -
                Math.cos(angle) * pushStrength;

            targetY =
                dot.baseY -
                Math.sin(angle) * pushStrength;
        }

        // Smooth movement
        dot.x += (targetX - dot.x) * 0.12;
        dot.y += (targetY - dot.y) * 0.12;

        // Dot size
        let radius = 1.2;

        if (distance < interactionRadius) {
            const force =
                (interactionRadius - distance) /
                interactionRadius;

            radius = 1.2 + force * 2.8;
        }

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);

        ctx.fillStyle = "#000";
        ctx.fill();
    });

    requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeCanvas);

window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
});

window.addEventListener("mouseleave", () => {
    mouse.x = -1000;
    mouse.y = -1000;
});

resizeCanvas();
animate();
