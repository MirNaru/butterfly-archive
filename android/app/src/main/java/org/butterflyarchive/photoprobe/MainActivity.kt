// 집 안 PC 연결·사진 선택·촬영 정보 확인·수동 전송 화면입니다.
package org.butterflyarchive.photoprobe

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.ViewModelProvider

class MainActivity: ComponentActivity() {
    private lateinit var model: TransferModel
    private lateinit var connection: TextView
    private lateinit var notice: TextView
    private lateinit var count: TextView
    private lateinit var pageInfo: TextView
    private lateinit var cards: LinearLayout
    private lateinit var code: EditText
    private lateinit var device: EditText
    private lateinit var send: Button
    private lateinit var retry: Button
    private lateinit var stop: Button
    private lateinit var previous: Button
    private lateinit var next: Button
    private val actions=ArrayList<Button>()
    private fun dp(value: Int)=(value*resources.displayMetrics.density).toInt()
    private fun column()=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
    private fun text(value: String,size: Float=14f)=TextView(this).apply {
        text=value;textSize=size;setTextColor(Color.rgb(41,39,32));setPadding(0,dp(5),0,dp(5));isSaveEnabled=false
    }
    private fun button(parent: LinearLayout,label: String,action: () -> Unit): Button {
        val view=Button(this).apply { text=label;isAllCaps=false;setOnClickListener { action() } }
        parent.addView(view,LinearLayout.LayoutParams(-1,-2));actions.add(view);return view
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model=ViewModelProvider(this)[TransferModel::class.java]
        val body=column().apply { setPadding(dp(16),dp(12),dp(16),dp(20));setBackgroundColor(Color.WHITE) }
        setContentView(ScrollView(this).apply { addView(body);fitsSystemWindows=true })
        body.addView(text("집 안 사진 전송",23f))
        body.addView(text("사진의 촬영 정보만 PC 자료 수집 대기함으로 보냅니다. 원본과 미리보기는 휴대폰에서만 사용합니다."))
        connection=text("");body.addView(connection)
        val panel=column().apply { setPadding(dp(12),dp(8),dp(12),dp(12));setBackgroundColor(Color.rgb(255,244,207)) }
        body.addView(panel)
        panel.addView(text("PC 자료 수집 → 내 사진에서 연결 코드를 발급해 주세요.\n집 안 주소: $LAN_ORIGIN"))
        device=EditText(this).apply { hint="기기 이름";setText("내 ${Build.MODEL}");filters=arrayOf(InputFilter.LengthFilter(80));isSaveEnabled=false }
        code=EditText(this).apply {
            hint="연결 코드 12자리";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            filters=arrayOf(InputFilter.LengthFilter(12));isSaveEnabled=false
        }
        panel.addView(device);panel.addView(code)
        button(panel,"PC 연결") { val value=code.text.toString().trim();code.text.clear();model.login(value,device.text.toString().trim()) }
        button(panel,"연결 상태 확인") { model.checkConnection() }
        button(panel,"로그아웃") { model.logout() }
        button(panel,"이 기기의 연결 정보 지우기") { model.forgetConnection() }
        notice=text("");body.addView(notice)
        body.addView(text("사진 선택",19f))
        button(body,"사진·촬영 위치 접근 허용") { requestPhotoPermissions() }
        button(body,"사진 권한 설정 열기") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName"))) }
        button(body,"사진 목록 처음부터 보기") { model.browse(0) }
        button(body,"선택 목록 보기") { model.showQueue() }
        count=text("");body.addView(count)
        button(body,"선택 정보 읽기 · 읽기 실패 다시 시도") { model.readSelection() }
        send=button(body,"확인한 정보 전송") { model.send(false) }.apply { setBackgroundColor(Color.rgb(251,188,4)) }
        retry=button(body,"전송 실패 항목 재시도") { model.send(true) }
        stop=button(body,"작업 중단") { model.cancel() }
        button(body,"선택 목록 비우기") { model.clearQueue() }
        body.addView(text("날짜·GPS를 확인한 뒤 전송해 주세요. PC에서 검수한 뒤 직접 관찰로 등록합니다. 사진 500장·한 장 32MB까지 지원합니다. 앱을 종료하면 선택 목록이 사라집니다."))
        pageInfo=text("");body.addView(pageInfo)
        previous=button(body,"이전 12장") { if(model.queueMode) model.showQueue(model.queuePage-1) else model.browse((model.galleryOffset-PAGE_SIZE).coerceAtLeast(0)) }
        cards=column();body.addView(cards)
        next=button(body,"다음 12장") { if(model.queueMode) model.showQueue(model.queuePage+1) else model.browse(model.galleryOffset+PAGE_SIZE) }
    }
    private fun granted(permission: String)=checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED
    private fun requestPhotoPermissions() {
        requestPermissions(arrayOf(Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,Manifest.permission.ACCESS_MEDIA_LOCATION),101)
    }
    override fun onStart() { super.onStart();model.listener={render()};render() }
    override fun onStop() {
        model.listener=null
        if(!isChangingConfigurations) model.cancel()
        super.onStop()
    }
    override fun onRequestPermissionsResult(requestCode: Int,permissions: Array<String>,grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults)
        if(requestCode==101&&hasPhotoAccess()&&granted(Manifest.permission.ACCESS_MEDIA_LOCATION)) model.browse(0)
        else if(requestCode==101) model.explainPhotoPermission()
        else render()
    }
    private fun hasPhotoAccess()=granted(Manifest.permission.READ_MEDIA_IMAGES)||granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
    private fun render() {
        val access=when {granted(Manifest.permission.READ_MEDIA_IMAGES)->"전체 사진 접근";hasPhotoAccess()->"선택한 사진 접근";else->"사진 권한 필요"}
        val location=if(granted(Manifest.permission.ACCESS_MEDIA_LOCATION)) "사진 위치 정보 허용" else "사진 위치 정보 권한 필요"
        connection.text="${model.connectionLabel}\n$access · $location"
        notice.text=model.message
        count.text="선택 ${model.queue.size}장 · 완료 ${model.queue.count { it.state==PhotoState.SENT }} · 중복 ${model.queue.count { it.state==PhotoState.DUPLICATE }} · 실패 ${model.queue.count { it.state==PhotoState.FAILED||it.state==PhotoState.READ_FAILED }}"
        actions.forEach { it.isEnabled=!model.busy }
        code.isEnabled=!model.busy;device.isEnabled=!model.busy
        send.isEnabled=!model.busy&&model.connected&&model.queue.any { it.state==PhotoState.READY }
        retry.isEnabled=!model.busy&&model.connected&&model.queue.any { it.state==PhotoState.FAILED }
        stop.isEnabled=model.busy
        previous.isEnabled=!model.busy&&(if(model.queueMode) model.queuePage>0 else model.galleryOffset>0)
        next.isEnabled=!model.busy&&(if(model.queueMode) (model.queuePage+1)*PAGE_SIZE<model.queue.size else model.hasNext)
        if(model.busy) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cards.removeAllViews()
        if(model.queueMode) {
            pageInfo.text="선택 목록 · ${model.queuePage+1}쪽 · 촬영 정보 확인"
            for(item in model.queue.drop(model.queuePage*PAGE_SIZE).take(PAGE_SIZE)) addCard(item.photo,item)
        } else {
            pageInfo.text=if(model.gallery.isEmpty()) "사진 목록을 열어 주세요." else "사진 목록 · ${model.galleryOffset+1}~${model.galleryOffset+model.gallery.size} · 필요한 사진만 체크하세요."
            for(photo in model.gallery) addCard(photo,null)
        }
    }
    private fun addCard(photo: GalleryPhoto,item: QueuePhoto?) {
        val row=column().apply { setPadding(dp(10),dp(8),dp(10),dp(8));setBackgroundColor(Color.rgb(255,253,246)) }
        cards.addView(row,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(10) })
        val heading=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        val image=ImageView(this).apply { scaleType=ImageView.ScaleType.CENTER_CROP;contentDescription=photo.name;setImageBitmap(model.thumbnail(photo.uri)) }
        heading.addView(image,LinearLayout.LayoutParams(dp(72),dp(72)))
        val check=CheckBox(this).apply {
            text=photo.name;isChecked=model.queue.any { it.photo.uri==photo.uri };isEnabled=!model.busy
            setOnCheckedChangeListener { _,selected -> model.select(photo,selected) }
        }
        heading.addView(check,LinearLayout.LayoutParams(0,-2,1f));row.addView(heading)
        if(item!=null) {
            row.addView(text(item.state.label))
            item.metadata?.let { row.addView(text(it.preview())) }
            if(item.error.isNotEmpty()) row.addView(text(item.error).apply { setTextColor(Color.rgb(163,44,32)) })
        }
    }
}
