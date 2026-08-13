/**
 * The item tree shared by both menu surfaces.
 *
 * The inline menu bar's dropdown and the hamburger's accordion render the same
 * `MenuItem[]` the same way — one list component rather than two, so the two
 * responsive states can never drift into showing different trees for the same
 * menu.
 *
 * Items may be inert two different ways, and they're not the same thing.
 * `onSelect` left undefined (most of the six menus, still) renders and
 * still closes the menu on click — a menu that swallows clicks differently
 * for wired and unwired items would be a worse demo of "they all open and
 * render their tree" than one that treats them alike. `disabled: true` (the
 * Terminal menu's Split/Kill/Clear with no session to act on) is a real
 * native `disabled` button instead: it neither fires `onSelect` nor closes
 * the menu, because a click that lands on a control with nothing to do
 * should not read as having done something.
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
            disabled={item.disabled}
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
