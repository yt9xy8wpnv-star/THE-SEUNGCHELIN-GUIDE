export function initMenu() {
  const menuButton = document.querySelector("#menu-button");
  const menuPanel = document.querySelector("#menu-panel");

  if (!menuButton || !menuPanel) return;

  const closeMenu = () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  };

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menuPanel.hidden;
    menuPanel.hidden = !willOpen;
    menuButton.setAttribute("aria-expanded", String(willOpen));
  });

  menuPanel.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}
