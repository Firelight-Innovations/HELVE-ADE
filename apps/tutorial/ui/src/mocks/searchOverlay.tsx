/** The search field's results, the locator tree, and the preview beside it —
 *  see `src/shell/search/SearchOverlay.tsx`. */
import { Col, MockTreeRow, MockWindow, Row, SkeletonText } from "./chrome";

/**
 * Results run the full width, and only the lower half splits in two — see
 * `SearchOverlay.tsx`: "Results run across the top. The lower half is split
 * in two, and both halves follow whichever row your pointer is over." A
 * three-way row would draw the locator and preview as equals to the results
 * list, which they are not — both read *one* focused result.
 */
export default function SearchOverlay() {
  return (
    <Col gap="sm">
      <span className="tut__mock-field">layout::PaneNode</span>

      <MockWindow title="Results">
        <Col gap="xs">
          <SkeletonText width="80%" />
          <SkeletonText width="65%" />
          <SkeletonText width="70%" />
        </Col>
      </MockWindow>

      <Row gap="sm" wrap>
        <MockWindow title="Where" className="tut__mock-grow">
          <MockTreeRow depth={0} label="src/" />
          <MockTreeRow depth={1} label="layout.rs" selected />
        </MockWindow>

        <MockWindow title="Preview" className="tut__mock-grow">
          <Col gap="xs">
            <SkeletonText width="90%" />
            <SkeletonText width="40%" />
            <SkeletonText width="75%" />
          </Col>
        </MockWindow>
      </Row>
    </Col>
  );
}
