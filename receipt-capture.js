(function () {
  console.log('📄 캡처 스크립트 시작');

  // 다양한 선택자 시도
  const RECEIPT_SELECTORS = [
    '.DetailReceipt_receipt_container__VqEGG',
    '.receipt_container',
    '.receipt',
    '#receipt',
    '.payment_receipt',
    '.order_receipt',
    'main',
    '.main-content',
    '#content',
    '#container',
    '.container',
    'body',
  ];

  function captureReceipt(combinedMode = false) {
    // 페이지가 완전히 로드될 때까지 대기
    console.log('영수증 캡처 시작');
    console.log('현재 document.readyState:', document.readyState);
    console.log('DOM 준비 상태 확인 - body 존재:', !!document.body);
    console.log(
      '통합 다운로드 모드:',
      combinedMode ? '활성화됨' : '비활성화됨'
    );

    // 여러 선택자 시도
    let receiptContainer = null;

    for (const selector of RECEIPT_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`선택자 '${selector}'로 요소를 찾았습니다!`);
        receiptContainer = element;
        break;
      }
    }

    // 선택자로 찾지 못한 경우 기본 요소 사용
    if (!receiptContainer) {
      console.log('선택자로 요소를 찾지 못했습니다. 기본 요소 사용');
      receiptContainer = document.documentElement || document.body;
    }

    if (!receiptContainer) {
      console.error('영수증 컨테이너를 찾을 수 없습니다.');
      return;
    }

    // 영수증 캡처
    html2canvas(receiptContainer, {
      scale: 1,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: function (clonedDoc) {
        return clonedDoc;
      },
    })
      .then(canvas => {
        // URL에서 주문 ID 추출
        const url = window.location.href;
        const orderId = url.match(/\/purchase\/(\d+)/)?.[1] || 'unknown';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // 이미지 데이터 생성
        const imgData = canvas.toDataURL('image/png', 0.8); // 0.8 품질로 설정하여 용량 최적화

        if (combinedMode) {
          // 통합 모드: 이미지 데이터를 백그라운드로 전송
          console.log('통합 모드: 이미지 데이터 전송');
          chrome.runtime.sendMessage({
            action: 'captureComplete',
            orderId: orderId,
            imageData: imgData,
          });
          console.log('✅ 이미지 데이터 전송 완료');
        } else {
          // 개별 모드: 직접 이미지로 다운로드
          const link = document.createElement('a');
          link.href = imgData;
          link.download = `네이버페이_영수증_${orderId}_${timestamp}.png`;
          document.body.appendChild(link);

          // 다운로드 시작
          link.click();

          // 다운로드 처리 시간 확보 후 정리
          document.body.removeChild(link);
          console.log('✅ 개별 이미지 저장 완료');

          // 캡처 완료 메시지 전송 (이미지 데이터 없이)
          chrome.runtime.sendMessage({
            action: 'captureComplete',
            orderId: orderId,
          });
        }
      })
      .catch(error => {
        console.error('영수증 캡처 중 오류 발생:', error);
        alert(
          '영수증 캡처에 실패했습니다. 개발자 도구의 콘솔을 확인해 주세요.'
        );

        // 오류 발생 시에도 캡처 완료 메시지 전송 (탭 닫기 위해)
        const url = window.location.href;
        const orderId = url.match(/\/purchase\/(\d+)/)?.[1] || 'unknown';
        chrome.runtime.sendMessage({
          action: 'captureComplete',
          orderId: orderId,
          error: error.message,
        });
      });
  }

  // 메시지 리스너 추가 - 백그라운드 스크립트에서 호출되는 메시지 처리
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'captureReceipt') {
      console.log('캡처 메시지 수신, 캡처 시작', message);
      // combinedMode 값 로깅하여 확인
      console.log(
        '캡처 모드:',
        message.combinedMode ? '통합 모드' : '개별 모드'
      );
      captureReceipt(message.combinedMode);
      return true; // 비동기 응답을 위해 true 반환
    }
  });
})();
