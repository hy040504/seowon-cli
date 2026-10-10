import assert from "node:assert/strict";
import test from "node:test";
import { noticeDetailText } from "../lib/back/filters.js";
import { fetchNoticeDetail } from "../lib/back/services/ecampus/classroom.js";
import type { EcampusClassroomItem, EcampusClient } from "../lib/back/engine/index.js";

const detailHtml = `
  <div class="post_view">
    <div class="header"><h4 id="atclTitleText">수업 공지 제목</h4>
      <ul class="viewInfo"><li>작성자</li><li>2026.10.09</li></ul>
      <div class="sns">공유하기</div>
    </div>
    <div id="atclCtsText" class="content-field">
      <div><p>첫 번째 안내입니다.</p><div>중첩된 안내입니다.</div></div>
      <p>마지막 안내입니다.<br>확인 바랍니다.</p>
    </div>
    <div class="file-list"><a href="/file/download/test.pdf">안내.pdf</a></div>
    <div class="comment"><label>댓글</label><textarea></textarea></div>
  </div>`;

test("현재 e-campus 응답에서 제목·작성자·첨부·댓글을 제외하고 본문 전체를 읽는다", () => {
  assert.equal(
    noticeDetailText(detailHtml),
    "첫 번째 안내입니다.\n중첩된 안내입니다.\n\n마지막 안내입니다.\n확인 바랍니다."
  );
});

test("빈 본문과 짧은 본문을 제목으로 대체하지 않는다", () => {
  for (const body of ["", "휴강", "<p>공지</p>"]) {
    const html = `<h4>긴 공지 제목입니다</h4><div id="atclCtsText">${body}</div><div class="view-cont">다른 영역</div>`;
    assert.equal(noticeDetailText(html), body.replace(/<[^>]+>/g, ""));
  }
});

test("본문 영역이 없으면 제목과 화면 전체를 본문으로 사용하지 않는다", () => {
  for (const html of ["", '<div class="bbs-view"><h4>공지 제목</h4><p>작성자</p></div>', '<form id="loginForm">로그인</form>']) {
    assert.equal(noticeDetailText(html), "");
  }
});

test("구버전 본문 영역에서도 중첩 요소 뒤의 내용을 보존한다", () => {
  for (const attributes of ['id="atclCn"', 'class="content-field"', 'class="view-cont"', 'class="view_cont"', 'class="viewcont"', 'class="view-content"']) {
    const html = `<h4>제목</h4><section ${attributes}><div>앞 내용</div><p>뒤 내용</p></section><p>첨부파일</p>`;
    assert.equal(noticeDetailText(html), "앞 내용\n뒤 내용");
  }
});

test("구버전 내용 라벨 다음의 본문만 읽고 첨부 라벨을 제외한다", () => {
  for (const content of [
    "<div><label>공지 내용</label><div>본문입니다.</div></div>",
    "<table><tr><th>게시글 내용</th><td>본문입니다.</td></tr></table>",
    "<dl><dt>글 내용</dt><dd>본문입니다.</dd></dl>"
  ]) {
    const html = `${content}<label>첨부파일</label><div>안내.pdf</div>`;
    assert.equal(noticeDetailText(html), "본문입니다.");
  }
});

test("본문의 스크립트·스타일을 제거하고 문단과 줄바꿈을 유지한다", () => {
  assert.equal(
    noticeDetailText('<div id="atclCtsText"><style>.x{color:red}</style><script>alert("test")</script><p>첫 줄<br>둘째 줄</p><p>셋째 줄</p></div>'),
    "첫 줄\n둘째 줄\n셋째 줄"
  );
});

test("공지 상세 서비스가 목록 요청으로 본문과 첨부를 함께 가져온다", async () => {
  const item: EcampusClassroomItem = {
    id: "ATCL_TEST", title: "수업 공지 제목", url: "https://ecampus.seowon.ac.kr/bbs/bbsLect/Form/viewAtclForm",
    request: { method: "POST", url: "https://ecampus.seowon.ac.kr/bbs/bbsLect/viewAtcl", body: { atclId: "ATCL_TEST", bbsId: "BBS_TEST_N", crsCreCd: "TEST" } }
  };
  let requests = 0;
  const client = {
    baseUrl: "https://ecampus.seowon.ac.kr",
    http: {
      async post(url: string, body: URLSearchParams) {
        requests += 1;
        assert.equal(url, "/bbs/bbsLect/viewAtcl");
        assert.deepEqual(Object.fromEntries(body), item.request.body);
        return { data: detailHtml };
      }
    },
    async getMaterialAttachments() { assert.fail("상세 HTML에 있는 첨부를 재조회할 필요가 없습니다."); }
  } as unknown as EcampusClient;
  const detail = await fetchNoticeDetail(client, item);
  assert.equal(detail.text, noticeDetailText(detailHtml));
  assert.deepEqual(detail.attachments, [{ title: "안내.pdf", url: "https://ecampus.seowon.ac.kr/file/download/test.pdf" }]);
  assert.equal(requests, 1);
});
