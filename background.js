chrome.runtime.onInstalled.addListener(() => {
  console.log('네이버페이 영수증 캡처 확장 프로그램이 설치되었습니다.');
  // 초기화 시 totalPrice를 0으로 설정
  chrome.storage.local.set({ totalPrice: 0 });
});

// 영수증 페이지를 열고 캡처하는 프로세스 관리
const pendingTabs = new Map(); // 탭 ID를 키로 하고 주문 ID를 값으로 저장
let savedTotalPrice = 0; // 메모리에 총액 저장
let capturedImages = []; // 캡처된 모든 이미지 저장 배열
let pendingOrderIds = new Set(); // 처리 대기 중인 주문 ID 집합
let combinedDownloadMode = false; // 통합 다운로드 모드 여부

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openReceiptPage') {
    console.log('영수증 페이지 열기 요청:', message.orderId);
    // 처리 대기 중인 주문 ID 목록에 추가
    pendingOrderIds.add(message.orderId);
    // 새 탭을 열고 활성화 (active: true)
    chrome.tabs.create(
      {
        url: message.url,
        active: true, // 탭을 활성화하여 다운로드 권한 확보
      },
      tab => {
        console.log(
          `탭 생성됨: ${tab.id} 주문 ID: ${message.orderId}, 모드: ${
            combinedDownloadMode ? '통합' : '개별'
          }`
        );
        pendingTabs.set(tab.id, message.orderId);
      }
    );
  } else if (message.action === 'captureComplete') {
    console.log('영수증 캡처 완료:', message.orderId);

    // 이미지 데이터가 있으면 배열에 저장
    if (message.imageData) {
      capturedImages.push({
        orderId: message.orderId,
        imageData: message.imageData,
        timestamp: new Date().toISOString(),
      });

      // 처리 완료된 주문 ID 제거
      pendingOrderIds.delete(message.orderId);

      // 모든 영수증 처리가 완료되었는지 확인
      if (pendingOrderIds.size === 0 && capturedImages.length > 0) {
        console.log('모든 영수증 캡처 완료, 결합 이미지 생성 가능');

        // 모든 팝업에 완료 메시지 전송 (통합 모드가 아니더라도 버튼 표시)
        chrome.runtime.sendMessage({
          action: 'allCapturesComplete',
          count: capturedImages.length,
        });

        if (combinedDownloadMode) {
          // 통합 다운로드 모드인 경우 자동으로 다운로드 시작
          console.log('통합 다운로드 모드: 자동 다운로드 시작');
          chrome.runtime.sendMessage({
            action: 'autoCombineAndDownload',
            count: capturedImages.length,
            images: capturedImages,
          });
        }
      }
    }

    // 캡처가 완료된 탭 찾기 및 닫기
    // 약간의 지연 후 탭 닫기 (다운로드 대화상자가 완전히 처리될 시간 확보)
    setTimeout(() => {
      chrome.tabs.query({}, tabs => {
        for (const [tabId, orderId] of pendingTabs.entries()) {
          if (orderId === message.orderId) {
            console.log(`탭 닫기 시도: ${tabId}`);
            try {
              chrome.tabs.remove(tabId, () => {
                if (chrome.runtime.lastError) {
                  console.warn(
                    `탭 닫기 실패: ${chrome.runtime.lastError.message}`
                  );
                } else {
                  console.log(`탭 닫기 성공: ${tabId}`);
                  pendingTabs.delete(tabId);
                }
              });
            } catch (err) {
              console.error(`탭 닫기 오류: ${err.message}`);
            }
            break;
          }
        }
      });
    }, 500); // 다운로드 처리를 위해 500ms 대기
  } else if (message.action === 'updateTotalPrice') {
    // 총액 업데이트 저장
    savedTotalPrice = message.totalPrice;
    console.log('백그라운드에 총액 저장:', savedTotalPrice);
    // storage에도 저장
    chrome.storage.local.set({ totalPrice: savedTotalPrice });
    // 열려있는 모든 팝업에 브로드캐스트
    chrome.runtime.sendMessage({
      action: 'totalPriceUpdated',
      totalPrice: savedTotalPrice,
    });

    return true; // 비동기 응답을 위해 true 반환
  } else if (message.action === 'getTotalPrice') {
    // 저장된 총액 반환
    if (sendResponse) {
      sendResponse({ totalPrice: savedTotalPrice });
    }
    return true; // 비동기 응답을 위해 true 반환
  } else if (message.action === 'setCombinedDownloadMode') {
    // 통합 다운로드 모드 설정
    combinedDownloadMode = message.enabled;
    console.log(
      '통합 다운로드 모드 설정:',
      combinedDownloadMode ? '활성화됨' : '비활성화됨'
    );

    // 응답 전송
    if (sendResponse) {
      sendResponse({
        success: true,
        mode: combinedDownloadMode ? 'combined' : 'individual',
      });
    }

    return true; // 비동기 응답을 위해 true 반환
  } else if (message.action === 'getCapturedImages') {
    // 저장된 이미지 목록 반환
    if (sendResponse) {
      sendResponse({
        images: capturedImages,
        count: capturedImages.length,
      });
    }
    return true; // 비동기 응답을 위해 true 반환
  } else if (message.action === 'downloadCombinedImage') {
    // 통합 이미지 다운로드 처리
    // 이미지는 이미 결합된 형태로 전달됨
    if (message.combinedImageData) {
      console.log('통합 이미지 다운로드 시작');

      // 다운로드 후 이미지 배열 초기화
      capturedImages = [];
      pendingOrderIds.clear();

      if (sendResponse) {
        sendResponse({ success: true });
      }
    }
    return true;
  } else if (message.action === 'clearCapturedImages') {
    // 저장된 이미지 초기화
    capturedImages = [];
    pendingOrderIds.clear();
    console.log('저장된 이미지 초기화 완료');

    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true;
  }
});

// 탭 로딩이 완료되면 자동으로 캡처 수행
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && pendingTabs.has(tabId)) {
    // 영수증 페이지 로딩이 완료된 경우
    if (tab.url.includes('m.pay.naver.com/o/receipt/purchase/')) {
      console.log(
        `탭 ${tabId} 로딩 완료, 영수증 캡처 시작, 모드: ${
          combinedDownloadMode ? '통합' : '개별'
        }`
      );
      // 약간의 지연 후 캡처 실행 (페이지가 완전히 렌더링될 시간 확보)
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          action: 'captureReceipt',
          combinedMode: combinedDownloadMode, // 통합 모드 여부 전달
        });
      }, 1000);
    }
  }
});
