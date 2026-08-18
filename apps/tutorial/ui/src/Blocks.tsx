/**
 * One tutorial's body, drawn.
 *
 * Steps are numbered here rather than in the content, by counting `step` blocks
 * as they go past. That is the only piece of state in this file and it exists so
 * a tutorial can gain a step in the middle without renumbering the ones after
 * it — the failure that makes a hand-numbered list wrong within one edit.
 */
import type { Block } from "./content/blocks";
import Inline, { Keys } from "./Inline";
import { MOCKS } from "./mocks/registry";

export default function Blocks({ blocks }: { blocks: Block[] }) {
  let step = 0;

  return (
    <div className="tut__body">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "text":
            return (
              <p key={index} className="tut__p">
                <Inline>{block.body}</Inline>
              </p>
            );

          case "heading":
            return (
              <h3 key={index} className="tut__h3">
                {block.body}
              </h3>
            );

          case "step":
            step += 1;
            return (
              <div key={index} className="tut__step">
                <span className="tut__step-n" aria-hidden="true">
                  {step}
                </span>
                <p className="tut__step-body">
                  <Inline>{block.body}</Inline>
                  {block.chord && (
                    <>
                      {" "}
                      <Keys chord={block.chord} />
                    </>
                  )}
                </p>
              </div>
            );

          case "note":
            return (
              <aside key={index} className="tut__aside tut__aside--note">
                <Inline>{block.body}</Inline>
              </aside>
            );

          case "soon":
            return (
              <aside key={index} className="tut__aside tut__aside--soon">
                <span className="tut__aside-tag">Not yet</span>
                <span>
                  <Inline>{block.body}</Inline>
                </span>
              </aside>
            );

          case "code":
            return (
              <pre key={index} className="tut__pre">
                <code>{block.body}</code>
              </pre>
            );

          case "keys":
            return (
              <table key={index} className="tut__keys">
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.chord}>
                      <td className="tut__keys-chord">
                        <Keys chord={row.chord} />
                      </td>
                      <td className="tut__keys-what">
                        <Inline>{row.what}</Inline>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );

          case "mock": {
            const Mock = MOCKS[block.view];
            return (
              <figure key={index} className="tut__mock">
                <Mock />
                {block.caption && (
                  <figcaption className="tut__mock-caption-block">
                    <Inline>{block.caption}</Inline>
                  </figcaption>
                )}
              </figure>
            );
          }

          case "flow":
            return (
              <div key={index} className="tut__flow">
                {block.steps.map((flowStep, i) => (
                  <span className="tut__flow-step-wrap" key={i}>
                    {i > 0 && (
                      <span className="tut__flow-arrow" aria-hidden="true">
                        →
                      </span>
                    )}
                    <span className="tut__flow-step">
                      <Inline>{flowStep}</Inline>
                    </span>
                  </span>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}
