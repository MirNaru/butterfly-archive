// 편집창 위·아래에 같은 문구와 동작의 저장 취소 확인을 표시합니다.
export default function CloseConfirmation({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  return <div className="close-confirmation" role="group" aria-label="저장하지 않고 닫기 확인">
    <span>작성 중인 내용을 저장하지 않고 닫으시겠습니까?</span>
    <button type="button" onClick={onContinue}>계속 작성</button>
    <button type="button" onClick={onDiscard}>저장하지 않고 닫기</button>
  </div>
}
