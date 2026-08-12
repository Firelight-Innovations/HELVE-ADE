/**
 * The item tree shared by both menu surfaces.
 *
 * The inline menu bar's dropdown and the hamburger's accordion render the same
 * `MenuItem[]` the same way — one list component rather than two, so the two
 * responsive states can never drift into showing different trees for the same
 * menu.
 *
 * Items may be inert (`onSelect` undefined, per `contract.ts`). They still
 * render and still close the menu on click — a menu that swallows clicks
 * differently for wired and unwired items would be a worse demo of "all eight
 * open and render their tree" than one that treats them alike.
 */
import type { MenuItem } from "../contract";

export default function MenuItemList({
  items,
  onAfterSelect,
}: {
  items: MenuItem[];
  onAfterSelect: () => void;
}) {
  return (
    <ul className="menu-list" role="menu">
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} role="none">
          {item.separatorBefore && <div className="menu-list__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className="menu-list__item"
            onClick={() => {
              item.onSelect?.();
              onAfterSelect();
            }}
          >
            <span className="menu-list__label">{item.label}</span>
            {item.accelerator && <span className="menu-list__accel">{item.accelerator}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
