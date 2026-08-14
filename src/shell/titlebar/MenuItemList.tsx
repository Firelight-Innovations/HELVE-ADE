/**
 * The item tree shared by both menu surfaces.
 *
 * The inline menu bar's dropdown and the hamburger's accordion render the same
 * `MenuItem[]` the same way — one list component rather than two, so the two
 * responsive states can never drift into showing different trees for the same
 * menu.
 *
 * An item that cannot act is `disabled: true` — a real native `disabled`
 * button, which neither fires `onSelect` nor closes the menu, because a click
 * that lands on a control with nothing to do should not read as having done
 * something. That is the only inert state left worth having: an item with no
 * `onSelect` at all now means the Run and Help menus, which are the two this
 * work deliberately did not touch.
 *
 * `hint` rides on the `<li>` rather than the button for the reason the contract
 * gives: a `disabled` button takes no pointer events, so a `title` on it would
 * be readable on precisely the items that never need explaining.
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
        <li key={`${item.label}-${i}`} role="none" title={item.hint}>
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
