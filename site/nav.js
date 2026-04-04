function getSharedNavItems() {
  return [
    { key: "home", href: "./index.html", label: "Home" },
    { key: "gpu", href: "./index.html?tab=gpu", label: "GPU" },
    { key: "gpu-lab", href: "./index.html?tab=gpu-lab", label: "GPU Lab" },
    { key: "compiler", href: "./index.html?tab=compiler", label: "Compiler" },
    { key: "unreal", href: "./unreal.html", label: "Unreal" },
    { key: "pathtracing", href: "./unreal.html?view=pathtracing", label: "PathTracing" },
    { key: "recent", href: "./index.html?tab=recent", label: "Recent" },
  ];
}

function renderSharedNav(activeKey) {
  const nav = document.getElementById("nav-tabs");
  if (!nav) return;

  nav.innerHTML = "";
  getSharedNavItems().forEach((item) => {
    const link = document.createElement("a");
    link.href = item.href;
    link.className = `nav-tab${item.key === activeKey ? " active" : ""}`;
    link.dataset.nav = item.key;
    link.textContent = item.label;
    nav.appendChild(link);
  });
}

window.renderSharedNav = renderSharedNav;
