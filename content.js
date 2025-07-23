console.log("네이버페이 주문내역 페이지 스크립트 실행");

(async () => {
  // 페이지가 완전히 로드될 때까지 대기
  if (document.readyState !== "complete") {
    await new Promise((resolve) => {
      window.addEventListener("load", resolve);
    });
  }

  const selectors = [
    'a[href*="order/status"]', // href 속성에 "order/status" 포함된 모든 링크
  ];

  let links = [];
  for (const selector of selectors) {
    links = [...document.querySelectorAll(selector)];
    console.log(`선택자 ${selector}로 ${links.length}개 링크 찾음`);
    if (links.length > 0) break;
  }

  const priceSelectors = ['span[class*="PaymentItem_price__"]'];

  let priceElements = [];
  for (const selector of priceSelectors) {
    priceElements = [...document.querySelectorAll(selector)];
    console.log(
      `가격 선택자 ${selector}로 ${priceElements.length}개 요소 찾음`
    );
    if (priceElements.length > 0) {
      console.log("성공한 선택자:", selector);
      break;
    }
  }

  // 추가적인 방법: XPath를 사용한 동적 클래스명 매칭
  if (priceElements.length === 0) {
    console.log("CSS 선택자로 찾지 못함, XPath 시도...");
    const xpath = "//span[contains(@class, 'PaymentItem_price__')]";
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    priceElements = Array.from({ length: result.snapshotLength }, (_, i) =>
      result.snapshotItem(i)
    );
    console.log(`XPath로 ${priceElements.length}개 요소 찾음`);
  }

  let totalPrice = null;
  if (priceElements.length > 0) {
    totalPrice = Array.from(priceElements)
      .map((el) => {
        const text = el.textContent.trim();
        console.log("가격 요소 텍스트:", text);
        return text.split("원")[0].replace(/,/g, ""); // 원 단위 제거 및 쉼표 제거
      })
      .map((price) => {
        const num = parseInt(price, 10);
        console.log("파싱된 가격:", num);
        return num;
      })
      .filter((price) => !isNaN(price)) // 유효한 숫자만 필터링
      .reduce((sum, price) => sum + price, 0); // 총액 계산

    console.log("계산된 총액:", totalPrice);

    // 계산된 총액을 background 스크립트에 전송
    chrome.runtime.sendMessage({
      action: "updateTotalPrice",
      totalPrice: totalPrice,
    });
  }

  if (!totalPrice) {
    console.warn(
      "총액을 찾을 수 없습니다. 페이지 구조가 변경되었을 수 있습니다."
    );
    chrome.storage.local.set({ totalPrice: null });
  }

  const orderIds = links
    .map((a) => {
      const match = a.href.match(/order\/status\/(\d{16})/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  console.log("찾은 주문 ID:", orderIds);

  if (orderIds.length === 0) {
    console.log(
      "주문 ID를 찾을 수 없습니다. 페이지 구조가 변경되었을 수 있습니다."
    );
    return;
  }

  for (const id of orderIds) {
    // 백그라운드 스크립트에 메시지 전송하여 영수증 페이지를 열고 캡처하도록 요청
    chrome.runtime.sendMessage({
      action: "openReceiptPage",
      orderId: id,
      url: `https://m.pay.naver.com/o/receipt/purchase/${id}`,
    });
    // 각 영수증 페이지 처리 사이에 간격을 두어 브라우저와 시스템 부하 줄이기
    // await new Promise(res => setTimeout(res, 500)); // 메시지 처리 딜레이 (0.5초)
  }
})();
