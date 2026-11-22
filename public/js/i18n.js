/**
 * Lightweight multilingual UI layer for AI Job Search.
 * Languages: en (default), th (Thai), cn (Simplified Chinese).
 *
 * The dictionaries below are display-only: stored profile / tracker / salary
 * data is never modified. Unknown strings fall back to English.
 */

const I18N_DICT = {
  en: {},
  th: {
    // Navigation / shell
    'AI Job Search': 'ค้นหางานด้วย AI',
    'Dashboard': 'แดชบอร์ด',
    'Job Search': 'ค้นหางาน',
    'Evaluate Fit': 'ประเมินความเหมาะสม',
    'Apply Workflow': 'ขั้นตอนการสมัคร',
    'Application Tracker': 'ติดตามการสมัคร',
    'Tracker': 'ติดตามการสมัคร',
    'Interview Prep': 'เตรียมสัมภาษณ์',
    'Salary Lookup': 'ค้นหาเงินเดือน',
    'Profile': 'โปรไฟล์',
    'Search Queries': 'คำค้นหาที่บันทึก',
    'Tools': 'เครื่องมือ',
    'Repo Browser': 'เบราว์เซอร์คลังโค้ด',
    'HTML Report': 'รายงาน HTML',
    'LLM Config': 'ตั้งค่า LLM',
    'Language': 'ภาษา',

    // Common
    'Overview of your job search pipeline': 'ภาพรวมของขั้นตอนการค้นหางานของคุณ',
    'Active': 'กำลังดำเนินการ',
    'Drafted': 'ร่าง',
    'Interview': 'สัมภาษณ์',
    'Offer': 'ข้อเสนอ',
    'Hired': 'ได้งาน',
    'Rejected': 'ถูกปฏิเสธ',
    'Rejected/Closed': 'ถูกปฏิเสธ/ปิด',
    'Applied': 'สมัครแล้ว',
    'Total Applications Sent': 'ใบสมัครที่ส่งทั้งหมด',
    'Jobs Discovered': 'งานที่ค้นพบ',
    'Funnel Rate (Past Resume Screen)': 'อัตราการผ่านการคัดกรองเรซูเม่',
    'Application Funnel': 'ช่องทางการสมัคร',
    'Profile Completion': 'ความสมบูรณ์ของโปรไฟล์',
    'By Sector': 'ตาม sector',
    'By Channel': 'ตามช่องทาง',
    'Edit Profile': 'แก้ไขโปรไฟล์',
    'No applications yet': 'ยังไม่มีการสมัคร',
    'No data': 'ไม่มีข้อมูล',
    'Name': 'ชื่อ',
    'Email': 'อีเมล',
    'Phone': 'โทรศัพท์',
    'Location': 'สถานที่',
    'Company': 'บริษัท',
    'Role': 'ตำแหน่ง',
    'Date': 'วันที่',
    'Status': 'สถานะ',
    'Actions': 'การดำเนินการ',
    'Save': 'บันทึก',
    'Cancel': 'ยกเลิก',
    'Close': 'ปิด',
    'Delete': 'ลบ',
    'Edit': 'แก้ไข',
    'Download': 'ดาวน์โหลด',
    'Generate': 'สร้าง',
    'Loading...': 'กำลังโหลด...',
    'None': 'ไม่มี',
    'Not set': 'ไม่ได้ระบุ',
    'Results': 'ผลลัพธ์',
    'No results': 'ไม่มีผลลัพธ์',

    // Job search
    'Keywords': 'คำสำคัญ',
    'Search': 'ค้นหา',
    'Fetch Jobs': 'ดึงงาน',
    'Paste Job Listings': 'วางประกาศงาน',
    'Save & Evaluate': 'บันทึกและประเมิน',
    'Discovered Jobs': 'งานที่ค้นพบ',
    'Why it matches': 'เหตุผลที่ตรง',
    'Active location:': 'สถานที่ที่ใช้งาน:',
    'Matching against:': 'จับคู่กับ:',
    'Detected region:': 'ภูมิภาคที่ตรวจพบ:',
    'Show all locations': 'แสดงทุกสถานที่',
    'Remote': 'งานระยะไกล',
    'not set': 'ไม่ได้ระบุ',
    'your location': 'สถานที่ของคุณ',

    // Apply / documents
    'Job Posting': 'ประกาศรับสมัคร',
    'Company Name': 'ชื่อบริษัท',
    'Role Title': 'ชื่อตำแหน่ง',
    'Analyze & Tailor': 'วิเคราะห์และปรับแต่ง',
    'Generate Documents': 'สร้างเอกสาร',
    'CV': 'เรซูเม่',
    'Cover Letter': 'จดหมายสมัครงาน',
    'Print': 'พิมพ์',
    'Copy': 'คัดลอก',
    'Why My Background Fits This Role': 'ทำไมพื้นฐานของฉันจึงเหมาะกับตำแหน่งนี้',
    'Please enter both site name and URL.': 'กรุณากรอกชื่อเว็บไซต์และ URL ให้ครบ',
    'Please enter both company name and role title.': 'กรุณากรอกชื่อบริษัทและตำแหน่งให้ครบ',
    'Please paste the job posting text so the resume can be tailored to it.': 'กรุณาวางข้อความประกาศรับสมัครเพื่อปรับแต่งเรซูเม่',
    'Please complete Step 1 (company, role and job posting) first.': 'กรุณาทำขั้นตอนที่ 1 ให้เสร็จก่อน (บริษัท ตำแหน่ง และประกาศงาน)',
    'Copied to clipboard!': 'คัดลอกไปยังคลิปบอร์ดแล้ว!',

    // Tracker
    'Add Application': 'เพิ่มใบสมัคร',
    'Channel': 'ช่องทาง',
    'Contact': 'ผู้ติดต่อ',
    'Deadline': 'กำหนดเวลา',
    'Follow-up': 'ติดตามผล',
    'Rej. Reason': 'เหตุผลที่ถูกปฏิเสธ',
    'No applications tracked yet.': 'ยังไม่มีการสมัครที่บันทึกไว้',
    'Delete failed:': 'การลบล้มเหลว:',
    'Unknown error': 'ข้อผิดพลาดที่ไม่รู้จัก',
    'drafted': 'ร่าง',
    'active': 'กำลังดำเนินการ',
    'interview': 'สัมภาษณ์',
    'offer': 'ข้อเสนอ',
    'hired': 'ได้งาน',
    'rejected': 'ถูกปฏิเสธ',

    // Salary
    'Compare salaries across Thailand, Malaysia, China, Vietnam': 'เปรียบเทียบเงินเดือนในไทย มาเลเซีย จีน และเวียดนาม',
    'Salary Data': 'ข้อมูลเงินเดือน',
    'Enter a company or role': 'ป้อนชื่อบริษัทหรือตำแหน่ง',
    'Look Up': 'ค้นหา',
    'List All': 'แสดงทั้งหมด',
    'City': 'เมือง',
    'Index': 'ดัชนี',
    'No salary data configured yet.': 'ยังไม่มีการตั้งค่าข้อมูลเงินเดือน',
    'MARKET BENCHMARKS ONLY - these are role-level market figures, NOT company-specific salary data.': 'เฉพาะค่าอ้างอิงตลาด - เป็นข้อมูลตามตำแหน่งงาน ไม่ใช่ข้อมูลเงินเดือนรายบริษัท',

    // Profile
    'Personal Info': 'ข้อมูลส่วนตัว',
    'Experience': 'ประสบการณ์',
    'Education': 'การศึกษา',
    'Skills': 'ทักษะ',
    'Languages': 'ภาษา',
    'Save Profile': 'บันทึกโปรไฟล์',
    'No experience added': 'ยังไม่มีประสบการณ์',

    // Queries / repo / report
    'Priorities': 'ลำดับความสำคัญ',
    'Location Filter': 'ตัวกรองสถานที่',
    'Acceptable': 'ยอมรับได้',
    'Borderline': 'ใกล้เคียง',
    'Too Far': 'ไกลเกินไป',
    'No priorities configured': 'ยังไม่มีการกำหนดลำดับความสำคัญ',
    'Configure job search priorities': 'กำหนดลำดับความสำคัญของการค้นหางาน',
    'Add Priority': 'เพิ่มลำดับความสำคัญ',
    'Create Priority': 'สร้างลำดับความสำคัญ',
    'Move Up': 'เลื่อนขึ้น',
    'Move Down': 'เลื่อนลง',
    'Untitled': 'ไม่ได้ตั้งชื่อ',
    'One keyword per line': 'หนึ่งคำสำคัญต่อหนึ่งบรรทัด',
    'One search query per line': 'หนึ่งคำค้นหาต่อหนึ่งบรรทัด',
    'Please enter a priority name': 'กรุณาป้อนชื่อลำดับความสำคัญ',
    'Delete this priority?': 'ต้องการลบลำดับความสำคัญนี้หรือไม่?',
    'Deleted': 'ลบแล้ว',
    'Add Location': 'เพิ่มสถานที่',
    'Location name': 'ชื่อสถานที่',
    'No locations configured': 'ยังไม่มีการกำหนดสถานที่',
    'Please enter a location': 'กรุณาป้อนชื่อสถานที่',
    'Delete this location?': 'ต้องการลบสถานที่นี้หรือไม่?',
    'Formatted': 'จัดรูปแบบแล้ว',
    'LaTeX source': 'ซอร์ส LaTeX',
    'Copy LaTeX': 'คัดลอก LaTeX',
    'No formatted preview saved for this document. Generate it again to create one.': 'ไม่มีตัวอย่างที่จัดรูปแบบสำหรับเอกสารนี้ กรุณาสร้างอีกครั้ง',
    'Profile Photo': 'รูปโปรไฟล์',
    'Upload Photo': 'อัปโหลดรูป',
    'Remove Photo': 'ลบรูป',
    'PNG, JPG, GIF or WEBP, up to 5 MB.': 'PNG, JPG, GIF หรือ WEBP ขนาดไม่เกิน 5 MB',
    'Please choose an image first.': 'กรุณาเลือกภาพก่อน',
    'Photo saved': 'บันทึกภาพแล้ว',
    'Remove profile photo?': 'ต้องการลบรูปโปรไฟล์หรือไม่?',
    'Photo removed': 'ลบภาพแล้ว',
    'Download CV PDF': 'ดาวน์โหลดเรซูเม่ PDF',
    'PDF downloaded': 'ดาวน์โหลด PDF แล้ว',
    'Repositories': 'คลังโค้ด',
    'Browse repository files': 'เรียกดูไฟล์ในคลังโค้ด',
    'Report Options': 'ตัวเลือกการสร้างรายงาน',
    'Generate Report': 'สร้างรายงาน',
    'Report Generated': 'สร้างรายงานแล้ว',
    'Generating...': 'กำลังสร้าง...',
    'Generate a comprehensive HTML report from your tracker data including:': 'สร้างรายงาน HTML ที่ครอบคลุมจากข้อมูลติดตามการสมัครของคุณ รวมถึง:',

    // LLM config
    'Provider Configuration': 'การตั้งค่าผู้ให้บริการ',
    'Saved Configurations': 'การตั้งค่าที่บันทึกไว้',
    'Provider': 'ผู้ให้บริการ',
    'API Key': 'คีย์ API',
    'Model Name': 'ชื่อโมเดล',
    'Base URL (optional)': 'URL พื้นฐาน (ไม่บังคับ)',
    'Save Configuration': 'บันทึกการตั้งค่า',
    'Test Connection': 'ทดสอบการเชื่อมต่อ',
    'Last configured:': 'ตั้งค่าล่าสุด:',
    'No configurations saved yet': 'ยังไม่มีการตั้งค่าที่บันทึกไว้',
    'Please fill in all required fields': 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ',
    'Please fill in all required fields before testing': 'กรุณากรอกข้อมูลที่จำเป็นให้ครบก่อนทดสอบ',
    'Configuration saved successfully': 'บันทึกการตั้งค่าเรียบร้อยแล้ว',
    'Connection test successful! Your provider configuration looks good.': 'ทดสอบการเชื่อมต่อสำเร็จ! การตั้งค่าผู้ให้บริการถูกต้อง',
    'Connection test failed:': 'การทดสอบการเชื่อมต่อล้มเหลว:',

    // Data values
    'Bangkok': 'กรุงเทพมหานคร',
    'Thailand': 'ประเทศไทย',
    'Malaysia': 'มาเลเซีย',
    'Vietnam': 'เวียดนาม',
    'China': 'จีน',
    'Singapore': 'สิงคโปร์',
    'Kuala Lumpur': 'กัวลาลัมเปอร์',
    'Shanghai': 'เซี่ยงไฮ้',
    'Ho Chi Minh City': 'นครโฮจิมินห์',
    'English': 'ภาษาอังกฤษ',
    'Chinese': 'ภาษาจีน',
    'Cantonese': 'ภาษากวางตุ้ง',
    'Thai': 'ภาษาไทย',
    'Professional': 'ระดับมืออาชีพ',
  },
  cn: {
    // Navigation / shell
    'AI Job Search': 'AI 求职助手',
    'Dashboard': '仪表盘',
    'Job Search': '职位搜索',
    'Evaluate Fit': '匹配度评估',
    'Apply Workflow': '申请流程',
    'Application Tracker': '申请跟踪',
    'Tracker': '申请跟踪',
    'Interview Prep': '面试准备',
    'Salary Lookup': '薪资查询',
    'Profile': '个人资料',
    'Search Queries': '搜索条件',
    'Tools': '工具',
    'Repo Browser': '仓库浏览',
    'HTML Report': 'HTML 报告',
    'LLM Config': '大模型配置',
    'Language': '语言',

    // Common
    'Overview of your job search pipeline': '求职进度总览',
    'Active': '进行中',
    'Drafted': '草稿',
    'Interview': '面试',
    'Offer': '录用通知',
    'Hired': '已入职',
    'Rejected': '已拒绝',
    'Rejected/Closed': '已拒绝/关闭',
    'Applied': '已申请',
    'Total Applications Sent': '已投递申请数',
    'Jobs Discovered': '已发现职位',
    'Funnel Rate (Past Resume Screen)': '简历筛选通过率',
    'Application Funnel': '申请漏斗',
    'Profile Completion': '资料完整度',
    'By Sector': '按行业',
    'By Channel': '按渠道',
    'Edit Profile': '编辑资料',
    'No applications yet': '暂无申请记录',
    'No data': '无数据',
    'Name': '姓名',
    'Email': '邮箱',
    'Phone': '电话',
    'Location': '地点',
    'Company': '公司',
    'Role': '职位',
    'Date': '日期',
    'Status': '状态',
    'Actions': '操作',
    'Save': '保存',
    'Cancel': '取消',
    'Close': '关闭',
    'Delete': '删除',
    'Edit': '编辑',
    'Download': '下载',
    'Generate': '生成',
    'Loading...': '加载中...',
    'None': '无',
    'Not set': '未设置',
    'Results': '结果',
    'No results': '无结果',

    // Job search
    'Keywords': '关键词',
    'Search': '搜索',
    'Fetch Jobs': '获取职位',
    'Paste Job Listings': '粘贴职位列表',
    'Save & Evaluate': '保存并评估',
    'Discovered Jobs': '已发现的职位',
    'Why it matches': '匹配原因',
    'Active location:': '当前地点：',
    'Matching against:': '匹配条件：',
    'Detected region:': '检测到的地区：',
    'Show all locations': '显示所有地点',
    'Remote': '远程',
    'not set': '未设置',
    'your location': '你的所在地',

    // Apply / documents
    'Job Posting': '招聘信息',
    'Company Name': '公司名称',
    'Role Title': '职位名称',
    'Analyze & Tailor': '分析并定制',
    'Generate Documents': '生成文档',
    'CV': '简历',
    'Cover Letter': '求职信',
    'Print': '打印',
    'Copy': '复制',
    'Why My Background Fits This Role': '我的背景为何适合该职位',
    'Please enter both site name and URL.': '请同时填写网站名称和网址。',
    'Please enter both company name and role title.': '请同时填写公司名称和职位名称。',
    'Please paste the job posting text so the resume can be tailored to it.': '请粘贴招聘信息，以便据此定制简历。',
    'Please complete Step 1 (company, role and job posting) first.': '请先完成第 1 步（公司、职位和招聘信息）。',
    'Copied to clipboard!': '已复制到剪贴板！',

    // Tracker
    'Add Application': '添加申请',
    'Channel': '渠道',
    'Contact': '联系人',
    'Deadline': '截止日期',
    'Follow-up': '跟进',
    'Rej. Reason': '拒绝原因',
    'No applications tracked yet.': '暂无跟踪的申请。',
    'Delete failed:': '删除失败：',
    'Unknown error': '未知错误',
    'drafted': '草稿',
    'active': '进行中',
    'interview': '面试',
    'offer': '录用通知',
    'hired': '已入职',
    'rejected': '已拒绝',

    // Salary
    'Compare salaries across Thailand, Malaysia, China, Vietnam': '比较泰国、马来西亚、中国和越南的薪资',
    'Salary Data': '薪资数据',
    'Enter a company or role': '输入公司或职位',
    'Look Up': '查询',
    'List All': '显示全部',
    'City': '城市',
    'Index': '指数',
    'No salary data configured yet.': '暂无薪资数据。',
    'MARKET BENCHMARKS ONLY - these are role-level market figures, NOT company-specific salary data.': '仅为市场参考值——按职位统计，并非特定公司的薪资数据。',

    // Profile
    'Personal Info': '个人信息',
    'Experience': '工作经历',
    'Education': '教育背景',
    'Skills': '技能',
    'Languages': '语言',
    'Save Profile': '保存资料',
    'No experience added': '暂无工作经历',

    // Queries / repo / report
    'Priorities': '优先级',
    'Location Filter': '地点筛选',
    'Acceptable': '可接受',
    'Borderline': '勉强可接受',
    'Too Far': '太远',
    'No priorities configured': '暂无优先级设置',
    'Configure job search priorities': '配置职位搜索优先级',
    'Add Priority': '添加优先级',
    'Create Priority': '创建优先级',
    'Move Up': '上移',
    'Move Down': '下移',
    'Untitled': '未命名',
    'One keyword per line': '每行一个关键词',
    'One search query per line': '每行一个搜索条件',
    'Please enter a priority name': '请输入优先级名称',
    'Delete this priority?': '确定删除此优先级吗？',
    'Deleted': '已删除',
    'Add Location': '添加地点',
    'Location name': '地点名称',
    'No locations configured': '暂无地点设置',
    'Please enter a location': '请输入地点名称',
    'Delete this location?': '确定删除此地点吗？',
    'Formatted': '排版预览',
    'LaTeX source': 'LaTeX 源码',
    'Copy LaTeX': '复制 LaTeX',
    'No formatted preview saved for this document. Generate it again to create one.': '此文档没有已保存的排版预览，请重新生成。',
    'Profile Photo': '个人照片',
    'Upload Photo': '上传照片',
    'Remove Photo': '移除照片',
    'PNG, JPG, GIF or WEBP, up to 5 MB.': '支持 PNG、JPG、GIF 或 WEBP，最大 5 MB。',
    'Please choose an image first.': '请先选择图片。',
    'Photo saved': '照片已保存',
    'Remove profile photo?': '确定移除个人照片吗？',
    'Photo removed': '照片已移除',
    'Download CV PDF': '下载简历 PDF',
    'PDF downloaded': 'PDF 已下载',
    'Repositories': '代码仓库',
    'Browse repository files': '浏览仓库文件',
    'Report Options': '报告选项',
    'Generate Report': '生成报告',
    'Report Generated': '报告已生成',
    'Generating...': '生成中...',
    'Generate a comprehensive HTML report from your tracker data including:': '根据申请跟踪数据生成完整的 HTML 报告，包括：',

    // LLM config
    'Provider Configuration': '服务商配置',
    'Saved Configurations': '已保存的配置',
    'Provider': '服务商',
    'API Key': 'API 密钥',
    'Model Name': '模型名称',
    'Base URL (optional)': '基础网址（可选）',
    'Save Configuration': '保存配置',
    'Test Connection': '测试连接',
    'Last configured:': '上次配置时间：',
    'No configurations saved yet': '暂无已保存的配置',
    'Please fill in all required fields': '请填写所有必填项',
    'Please fill in all required fields before testing': '测试前请填写所有必填项',
    'Configuration saved successfully': '配置保存成功',
    'Connection test successful! Your provider configuration looks good.': '连接测试成功！服务商配置正确。',
    'Connection test failed:': '连接测试失败：',

    // Data values
    'Bangkok': '曼谷',
    'Thailand': '泰国',
    'Malaysia': '马来西亚',
    'Vietnam': '越南',
    'China': '中国',
    'Singapore': '新加坡',
    'Kuala Lumpur': '吉隆坡',
    'Shanghai': '上海',
    'Ho Chi Minh City': '胡志明市',
    'English': '英语',
    'Chinese': '中文',
    'Cantonese': '粤语',
    'Thai': '泰语',
    'Professional': '熟练',
  },
};

// Additional UI strings harvested from all rendered pages. Keeping them in a
// separate Object.assign block makes it easy to extend without touching the
// base dictionaries above.
Object.assign(I18N_DICT.th, {
  'MARKET BENCHMARKS ONLY - these are role-level market figures, NOT company-specific salary data. THB = Thai baht, MYR = Malaysian ringgit, VND = Vietnamese dong, CNY = Chinese yuan. Values are gross annual base salary unless the category says otherwise. Because currencies differ, do not compare values across countries directly.': 'เฉพาะค่าอ้างอิงตลาดเท่านั้น - เป็นข้อมูลระดับตำแหน่งงาน ไม่ใช่ข้อมูลเงินเดือนรายบริษัท THB = บาทไทย, MYR = ริงกิตมาเลเซีย, VND = ดองเวียดนาม, CNY = หยวนจีน ค่าเป็นเงินเดือนพื้นฐานต่อปีก่อนหักภาษี เว้นแต่หมวดหมู่จะระบุไว้เป็นอย่างอื่น เนื่องจากสกุลเงินต่างกัน จึงไม่ควรเปรียบเทียบข้ามประเทศโดยตรง',
  'Action': 'การดำเนินการ', 'Actions': 'การดำเนินการ', 'Add Website': 'เพิ่มเว็บไซต์',
  'Connected': 'เชื่อมต่อแล้ว', 'Not connected': 'ยังไม่ได้เชื่อมต่อ',
  'Local fallback:': 'ใช้ข้อมูลภายในแทน:', 'Local parser': 'ตัววิเคราะห์ภายใน',
  'Parse warning:': 'คำเตือนในการวิเคราะห์:', 'Detected language:': 'ภาษาที่ตรวจพบ:',
  'Configuration storage path:': 'ตำแหน่งที่เก็บการตั้งค่า:',
  'Last connected:': 'เชื่อมต่อล่าสุด:',
  'No successful connection test yet': 'ยังไม่มีการทดสอบการเชื่อมต่อที่สำเร็จ',
  'Checking...': 'กำลังตรวจสอบ...',
  'Testing...': 'กำลังทดสอบ...',
  'Password': 'รหัสผ่าน',
  'Sign in': 'เข้าสู่ระบบ',
  'Create account': 'สร้างบัญชี',
  'Already have an account? Sign in': 'มีบัญชีแล้ว? เข้าสู่ระบบ',
  'Need an account? Register': 'ยังไม่มีบัญชี? ลงทะเบียน',
  'Log out': 'ออกจากระบบ',
  'Session expired. Please sign in again.': 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
  'This page requires the Pro plan.': 'หน้านี้ต้องใช้แพ็กเกจ Pro',
  'This page requires the Team plan.': 'หน้านี้ต้องใช้แพ็กเกจ Team',
  'Test Current Model': 'ทดสอบโมเดลปัจจุบัน',
  'Local template content is in English. Configure a working AI model to generate content in the selected language.': 'เนื้อหาของเทมเพลตในเครื่องเป็นภาษาอังกฤษ กรุณาตั้งค่าโมเดล AI ที่ใช้งานได้เพื่อสร้างเนื้อหาเป็นภาษาที่เลือก',
  'AUTO - try models in order': 'AUTO - ลองตามลำดับโมเดล',
  'Configure multiple LLM models and choose one, or let the system pick a working model automatically': 'ตั้งค่าโมเดล LLM หลายตัวและเลือกใช้งาน หรือให้ระบบเลือกโมเดลที่ใช้งานได้โดยอัตโนมัติ',
  'Active Model': 'โมเดลที่ใช้งาน',
  'AUTO mode tries each enabled model in order and uses the first one that responds.': 'โหมด AUTO จะลองแต่ละโมเดลตามลำดับและใช้โมเดลแรกที่ตอบสนอง',
  'Saved Models': 'โมเดลที่บันทึกไว้',
  'Add / Edit Model': 'เพิ่ม / แก้ไขโมเดล',
  'Model Label': 'ชื่อโมเดลที่แสดง',
  'Save Model': 'บันทึกโมเดล',
  'Test All Models': 'ทดสอบทุกโมเดล',
  'New Model': 'โมเดลใหม่',
  'No models saved yet': 'ยังไม่มีโมเดลที่บันทึกไว้',
  'Untested': 'ยังไม่ได้ทดสอบ',
  'Failed': 'ล้มเหลว',
  'Disabled': 'ปิดใช้งาน',
  'Title': 'หัวข้อ', 'Interview Preparation': 'การเตรียมสัมภาษณ์',
  'Select from Tracker (optional)': 'เลือกจากตัวติดตาม (ไม่บังคับ)',
  'Anywhere in the World': 'ทุกที่ในโลก', 'API Key': 'คีย์ API',
  'Application Funnel': 'ช่องทางการสมัคร', 'Complete your profile to improve results': 'กรอกโปรไฟล์ให้ครบเพื่อผลลัพธ์ที่ดีขึ้น',
  'Configure an external LLM provider for AI-powered question answering and interview prep enhancement': 'ตั้งค่าผู้ให้บริการ LLM สำหรับการตอบคำถามและเตรียมสัมภาษณ์ด้วย AI',
  'Configure job search priorities': 'กำหนดลำดับความสำคัญในการค้นหางาน',
  'Configured Search Priorities': 'ลำดับความสำคัญที่ตั้งค่าไว้', 'Change in Profile': 'การเปลี่ยนแปลงในโปรไฟล์',
  'Choose an application or fill in manually below.': 'เลือกใบสมัครหรือกรอกข้อมูลด้านล่างเอง',
  'Discovered jobs matching your profile': 'งานที่ค้นพบซึ่งตรงกับโปรไฟล์ของคุณ',
  'Evaluate': 'ประเมิน', 'Evaluate Job Fit': 'ประเมินความเหมาะสมกับงาน',
  'Extract Jobs from Text': 'ดึงงานจากข้อความ', 'Extract Jobs from URL': 'ดึงงานจาก URL',
  'Fit': 'ความเหมาะสม', 'Generate Prep Pack': 'สร้างชุดเตรียมตัว',
  'Generate stage-specific prep pack: STAR examples, likely questions, talking points': 'สร้างชุดเตรียมตัวตามขั้นตอน: ตัวอย่าง STAR คำถามที่น่าจะเจอ และประเด็นพูดคุย',
  'HR-tailored workflow: analyze the posting, review the resume edits, then generate a CV + cover letter built for this role': 'ขั้นตอนปรับแต่งโดย HR: วิเคราะห์ประกาศ ตรวจทานการแก้ไขเรซูเม่ แล้วสร้างเรซูเม่และจดหมายสมัครงานให้ตรงตำแหน่ง',
  'Job Page URL': 'URL หน้างาน', 'Job Posting (URL or full text)': 'ประกาศงาน (URL หรือข้อความเต็ม)',
  'Job Posting (optional, for tailored questions)': 'ประกาศงาน (ไม่บังคับ สำหรับคำถามที่ปรับแต่งแล้ว)',
  'Job Posting Text (required for tailoring)': 'ข้อความประกาศงาน (จำเป็นสำหรับการปรับแต่ง)',
  'Keywords for site search links': 'คำสำคัญสำหรับลิงก์ค้นหาในเว็บไซต์',
  'Loading sites...': 'กำลังโหลดเว็บไซต์...',
  'Only jobs matching your profile are listed': 'แสดงเฉพาะงานที่ตรงกับโปรไฟล์ของคุณ',
  'Open the site in your browser, select and copy the job listings (titles + company names), then paste below.': 'เปิดเว็บไซต์ในเบราว์เซอร์ เลือกและคัดลอกประกาศงาน (ชื่อตำแหน่ง + ชื่อบริษัท) แล้ววางด้านล่าง',
  'Paste a job board URL — the system tries multiple methods to retrieve listings. If a site blocks automated access (HTTP 403), it automatically falls back to a text proxy and a related job-news search, and always gives you a direct browser link.': 'วาง URL เว็บไซต์งาน ระบบจะลองหลายวิธีเพื่อดึงประกาศ หากเว็บไซต์บล็อกการเข้าถึงอัตโนมัติ (HTTP 403) ระบบจะสำรองไปใช้พร็อกซีข้อความและการค้นหาข่าวงานที่เกี่ยวข้อง พร้อมลิงก์เปิดในเบราว์เซอร์เสมอ',
  'Paste a job posting to evaluate it against your profile using the 5-dimension scoring framework': 'วางประกาศงานเพื่อประเมินกับโปรไฟล์ของคุณด้วยกรอบการให้คะแนน 5 มิติ',
  'Paste the full job posting here. The more detail you paste, the better the CV can be tailored...': 'วางประกาศงานฉบับเต็มที่นี่ รายละเอียดมากขึ้นจะช่วยปรับแต่งเรซูเม่ได้ดีขึ้น...',
  'Paste the full job posting text here, or a job posting URL...': 'วางข้อความประกาศงานฉบับเต็ม หรือ URL ประกาศงาน...',
  'Paste the job posting text...': 'วางข้อความประกาศงาน...',
  'Priorities': 'ลำดับความสำคัญ', 'Profile Completion': 'ความสมบูรณ์ของโปรไฟล์',
  'Profile ready for applications': 'โปรไฟล์พร้อมสมัครงานแล้ว', 'Profile:': 'โปรไฟล์:',
  'RemoteOK (fallback)': 'RemoteOK (สำรอง)', 'Rej. Reason': 'เหตุผลที่ถูกปฏิเสธ',
  'Searches live listings from RemoteOK and Arbeitnow (public APIs) and saves matching jobs': 'ค้นหาประกาศจริงจาก RemoteOK และ Arbeitnow (API สาธารณะ) และบันทึกงานที่ตรงกัน',
  'Search Live Jobs': 'ค้นหางานจริง', 'Search URL Template': 'แม่แบบ URL การค้นหา',
  'Set your location in': 'ตั้งค่าสถานที่ของคุณใน',
  'Sites blocking access? Paste the job listings text instead': 'เว็บไซต์บล็อกการเข้าถึง? ให้วางข้อความประกาศงานแทน',
  'Site Name': 'ชื่อเว็บไซต์', 'Source': 'แหล่งข้อมูล', 'Samples': 'ตัวอย่าง',
  'Step 1: Job Details': 'ขั้นตอนที่ 1: รายละเอียดงาน',
  'Total Applications Sent': 'ใบสมัครที่ส่งทั้งหมด',
  'Track every application from drafted to outcome — add new applications via the Apply Workflow page': 'ติดตามใบสมัครตั้งแต่ร่างจนถึงผลลัพธ์ — เพิ่มใบสมัครผ่านหน้าขั้นตอนการสมัคร',
  'View Cover Letter': 'ดูจดหมายสมัครงาน', 'View HR tailoring details': 'ดูรายละเอียดการปรับแต่งโดย HR',
  'View generated CV': 'ดูเรซูเม่ที่สร้างแล้ว', 'View saved job posting': 'ดูประกาศงานที่บันทึกไว้',
  'Web search': 'ค้นหาในเว็บ', 'Why it matches': 'เหตุผลที่ตรง',
  'for keywords and': 'สำหรับคำสำคัญและ', 'for location in the URL, e.g.': 'สำหรับสถานที่ใน URL เช่น',
  'to change these suggestions.': 'เพื่อเปลี่ยนคำแนะนำเหล่านี้',
  '⚙️ Add Your Own Job Website': '⚙️ เพิ่มเว็บไซต์งานของคุณเอง',
  '🎤 Prep': '🎤 เตรียมตัว', '💾 Save As Query': '💾 บันทึกเป็นคำค้นหา',
  '📍 Job Sites for Your Location': '📍 เว็บไซต์งานตามสถานที่ของคุณ',
  '🔍 Analyze Job & Tailor Resume': '🔍 วิเคราะห์งานและปรับแต่งเรซูเม่',
  '🔍 Search Live Job APIs': '🔍 ค้นหางานจริงผ่าน API',
  '🔗 Extract Jobs from a URL': '🔗 ดึงงานจาก URL',
  'Save current keywords as a searchable priority': 'บันทึกคำสำคัญปัจจุบันเป็นลำดับความสำคัญที่ค้นหาได้',
  'Add a job site you want to search. Use': 'เพิ่มเว็บไซต์งานที่ต้องการค้นหา ใช้',
  'Upload Resume': 'อัปโหลดเรซูเม่',
  'Upload a PDF, DOCX, TXT or HTML resume. The system reads the file directly and extracts profile fields for review.': 'อัปโหลดเรซูเม่ PDF, DOCX, TXT หรือ HTML ระบบจะอ่านไฟล์โดยตรงและสกัดข้อมูลโปรไฟล์ให้ตรวจทาน',
  'Read Resume File': 'อ่านไฟล์เรซูเม่', 'Or paste resume text': 'หรือวางข้อความเรซูเม่',
  'Paste resume text here': 'วางข้อความเรซูเม่ที่นี่', 'Analyze Pasted Text': 'วิเคราะห์ข้อความที่วาง',
  'Resume read successfully': 'อ่านเรซูเม่สำเร็จ', 'Reading resume file...': 'กำลังอ่านไฟล์เรซูเม่...',
  'Analyzing resume text...': 'กำลังวิเคราะห์ข้อความเรซูเม่...',
  'Replace Profile With Resume': 'แทนที่โปรไฟล์ด้วยเรซูเม่', 'Merge Into Profile': 'ผสานเข้ากับโปรไฟล์',
  'Please choose a resume file first.': 'กรุณาเลือกไฟล์เรซูเม่ก่อน',
  'Please paste resume text first.': 'กรุณาวางข้อความเรซูเม่ก่อน',
  'Profile saved': 'บันทึกโปรไฟล์แล้ว', 'Save failed': 'การบันทึกล้มเหลว',
  'Save failed:': 'การบันทึกล้มเหลว:', 'Profile saved successfully': 'บันทึกโปรไฟล์เรียบร้อยแล้ว',
  'Level': 'ระดับ', 'Degree': 'ระดับการศึกษา', 'Institution': 'สถาบัน', 'Topics': 'หัวข้อ',
  'Remove': 'ลบ', 'Start': 'เริ่ม', 'End': 'สิ้นสุด',
  'Bullets (one per line)': 'ข้อความแสดงผลงาน (หนึ่งบรรทัดต่อรายการ)',
  'Add Language': 'เพิ่มภาษา', 'Add Experience': 'เพิ่มประสบการณ์', 'Add Education': 'เพิ่มการศึกษา',
  'Career Goals': 'เป้าหมายอาชีพ', 'Target Roles': 'ตำแหน่งเป้าหมาย',
  'Primary': 'หลัก', 'Secondary': 'รอง', 'Domain': 'โดเมน', 'Software': 'ซอฟต์แวร์',
  'CV Language': 'ภาษาของเรซูเม่', 'Status': 'สถานะ', 'LinkedIn': 'LinkedIn', 'GitHub': 'GitHub',
  'Search failed:': 'การค้นหาล้มเหลว:', 'Lookup failed:': 'การค้นหาล้มเหลว:',
  'Role keywords:': 'คำหลักตำแหน่ง:', 'Skills:': 'ทักษะ:', 'Index:': 'ดัชนี:',
});

Object.assign(I18N_DICT.cn, {
  'MARKET BENCHMARKS ONLY - these are role-level market figures, NOT company-specific salary data. THB = Thai baht, MYR = Malaysian ringgit, VND = Vietnamese dong, CNY = Chinese yuan. Values are gross annual base salary unless the category says otherwise. Because currencies differ, do not compare values across countries directly.': '仅为市场参考值——按职位统计，并非特定公司的薪资数据。THB = 泰铢，MYR = 马来西亚林吉特，VND = 越南盾，CNY = 人民币。除类别另有说明外，数值均为税前年度基本工资。由于币种不同，请勿直接跨国比较。',
  'Action': '操作', 'Actions': '操作', 'Add Website': '添加网站',
  'Connected': '已连接', 'Not connected': '未连接',
  'Local fallback:': '本地回退：', 'Local parser': '本地解析器',
  'Parse warning:': '解析提示：', 'Detected language:': '检测语言：',
  'Configuration storage path:': '配置存储路径：',
  'Last connected:': '上次连接：',
  'No successful connection test yet': '尚无成功的连接测试',
  'Checking...': '检查中...',
  'Testing...': '正在测试...',
  'Password': '密码',
  'Sign in': '登录',
  'Create account': '创建账号',
  'Already have an account? Sign in': '已有账号？登录',
  'Need an account? Register': '还没有账号？注册',
  'Log out': '退出登录',
  'Session expired. Please sign in again.': '登录已过期，请重新登录',
  'This page requires the Pro plan.': '此页面需要 Pro 套餐',
  'This page requires the Team plan.': '此页面需要 Team 套餐',
  'Test Current Model': '测试当前模型',
  'Local template content is in English. Configure a working AI model to generate content in the selected language.': '本地模板内容为英文。请配置可用的 AI 模型，以生成所选语言的内容。',
  'AUTO - try models in order': '自动 - 按顺序尝试模型',
  'Configure multiple LLM models and choose one, or let the system pick a working model automatically': '配置多个大模型并指定使用其一，或让系统自动选择可用模型',
  'Active Model': '当前模型',
  'AUTO mode tries each enabled model in order and uses the first one that responds.': 'AUTO 模式会按顺序尝试每个启用的模型，并使用第一个可用的模型。',
  'Saved Models': '已保存的模型',
  'Add / Edit Model': '添加 / 编辑模型',
  'Model Label': '模型显示名称',
  'Save Model': '保存模型',
  'Test All Models': '测试所有模型',
  'New Model': '新建模型',
  'No models saved yet': '尚未保存模型',
  'Untested': '未测试',
  'Failed': '失败',
  'Disabled': '已禁用',
  'Title': '标题', 'Interview Preparation': '面试准备',
  'Select from Tracker (optional)': '从申请记录中选择（可选）',
  'Anywhere in the World': '世界任何地方', 'API Key': 'API 密钥',
  'Application Funnel': '申请漏斗', 'Complete your profile to improve results': '完善资料以获得更好结果',
  'Configure an external LLM provider for AI-powered question answering and interview prep enhancement': '配置外部大模型服务商，用于 AI 问答和面试准备增强',
  'Configure job search priorities': '配置求职搜索优先级',
  'Configured Search Priorities': '已配置的搜索优先级', 'Change in Profile': '资料变更',
  'Choose an application or fill in manually below.': '选择一条申请记录或在下方手动填写',
  'Discovered jobs matching your profile': '发现的匹配职位',
  'Evaluate': '评估', 'Evaluate Job Fit': '评估职位匹配度',
  'Extract Jobs from Text': '从文本提取职位', 'Extract Jobs from URL': '从网址提取职位',
  'Fit': '匹配度', 'Generate Prep Pack': '生成准备资料',
  'Generate stage-specific prep pack: STAR examples, likely questions, talking points': '分阶段生成准备资料：STAR 示例、常见问题、谈吐要点',
  'HR-tailored workflow: analyze the posting, review the resume edits, then generate a CV + cover letter built for this role': 'HR 定制流程：分析招聘信息、审阅简历修改，然后生成针对该职位的简历和求职信',
  'Job Page URL': '职位页面网址', 'Job Posting (URL or full text)': '招聘信息（网址或全文）',
  'Job Posting (optional, for tailored questions)': '招聘信息（可选，用于定制问题）',
  'Job Posting Text (required for tailoring)': '招聘信息文本（定制时必填）',
  'Keywords for site search links': '网站搜索链接的关键词',
  'Loading sites...': '正在加载网站...',
  'Only jobs matching your profile are listed': '仅显示与资料匹配的职位',
  'Open the site in your browser, select and copy the job listings (titles + company names), then paste below.': '在浏览器中打开该网站，复制职位列表（职位名称 + 公司名称），然后粘贴到下方',
  'Paste a job board URL — the system tries multiple methods to retrieve listings. If a site blocks automated access (HTTP 403), it automatically falls back to a text proxy and a related job-news search, and always gives you a direct browser link.': '粘贴招聘网站网址——系统会尝试多种方式获取职位。若网站阻止自动访问（HTTP 403），会自动改用文本代理和相关职位新闻搜索，并始终提供浏览器直达链接。',
  'Paste a job posting to evaluate it against your profile using the 5-dimension scoring framework': '粘贴招聘信息，使用五维评分框架与你的资料进行匹配评估',
  'Paste the full job posting here. The more detail you paste, the better the CV can be tailored...': '在此粘贴完整招聘信息。内容越详细，简历定制效果越好...',
  'Paste the full job posting text here, or a job posting URL...': '在此粘贴完整招聘信息文本，或招聘信息网址...',
  'Paste the job posting text...': '粘贴招聘信息文本...',
  'Priorities': '优先级', 'Profile Completion': '资料完整度',
  'Profile ready for applications': '资料已完善，可用于申请', 'Profile:': '资料：',
  'RemoteOK (fallback)': 'RemoteOK（备用）', 'Rej. Reason': '拒绝原因',
  'Searches live listings from RemoteOK and Arbeitnow (public APIs) and saves matching jobs': '从 RemoteOK 和 Arbeitnow（公开 API）搜索实时职位并保存匹配结果',
  'Search Live Jobs': '搜索实时职位', 'Search URL Template': '搜索网址模板',
  'Set your location in': '在以下位置设置你的所在地',
  'Sites blocking access? Paste the job listings text instead': '网站阻止访问？请改为粘贴职位文本',
  'Site Name': '网站名称', 'Source': '来源', 'Samples': '样本',
  'Step 1: Job Details': '第 1 步：职位详情',
  'Total Applications Sent': '已投递申请数',
  'Track every application from drafted to outcome — add new applications via the Apply Workflow page': '跟踪每份申请从草稿到结果——通过申请流程页面添加新申请',
  'View Cover Letter': '查看求职信', 'View HR tailoring details': '查看 HR 定制详情',
  'View generated CV': '查看生成的简历', 'View saved job posting': '查看保存的招聘信息',
  'Web search': '网页搜索', 'Why it matches': '匹配原因',
  'for keywords and': '用于关键词，', 'for location in the URL, e.g.': '用于网址中的地点，例如',
  'to change these suggestions.': '以更改这些建议。',
  '⚙️ Add Your Own Job Website': '⚙️ 添加你自己的招聘网站',
  '🎤 Prep': '🎤 准备', '💾 Save As Query': '💾 保存为搜索条件',
  '📍 Job Sites for Your Location': '📍 适合你所在地的招聘网站',
  '🔍 Analyze Job & Tailor Resume': '🔍 分析职位并定制简历',
  '🔍 Search Live Job APIs': '🔍 通过 API 搜索实时职位',
  '🔗 Extract Jobs from a URL': '🔗 从网址提取职位',
  'Save current keywords as a searchable priority': '将当前关键词保存为可搜索的优先级',
  'Add a job site you want to search. Use': '添加要搜索的招聘网站。使用',
  'Upload Resume': '上传简历',
  'Upload a PDF, DOCX, TXT or HTML resume. The system reads the file directly and extracts profile fields for review.': '上传 PDF、DOCX、TXT 或 HTML 简历。系统会直接读取文件并提取资料字段供审阅。',
  'Read Resume File': '读取简历文件', 'Or paste resume text': '或粘贴简历文本',
  'Paste resume text here': '在此粘贴简历文本', 'Analyze Pasted Text': '分析粘贴的文本',
  'Resume read successfully': '简历读取成功', 'Reading resume file...': '正在读取简历文件...',
  'Analyzing resume text...': '正在分析简历文本...',
  'Replace Profile With Resume': '用简历替换资料', 'Merge Into Profile': '合并到资料',
  'Please choose a resume file first.': '请先选择简历文件',
  'Please paste resume text first.': '请先粘贴简历文本',
  'Profile saved': '资料已保存', 'Save failed': '保存失败',
  'Save failed:': '保存失败：', 'Profile saved successfully': '资料保存成功',
  'Level': '水平', 'Remove': '删除', 'Start': '开始', 'End': '结束',
  'Degree': '学历', 'Institution': '学校', 'Topics': '专业/科目',
  'Bullets (one per line)': '工作成果（每行一条）',
  'Add Language': '添加语言', 'Add Experience': '添加工作经历', 'Add Education': '添加教育背景',
  'Career Goals': '职业目标', 'Target Roles': '目标职位',
  'Primary': '主要', 'Secondary': '次要', 'Domain': '领域', 'Software': '软件',
  'CV Language': '简历语言', 'Status': '状态', 'LinkedIn': 'LinkedIn', 'GitHub': 'GitHub',
  'Search failed:': '搜索失败：', 'Lookup failed:': '查询失败：',
  'Role keywords:': '职位关键词：', 'Skills:': '技能：', 'Index:': '指数：',
});

function normalizeLang(lang) {
  if (lang === 'zh' || lang === 'zh-CN' || lang === 'zh_CN') return 'cn';
  return I18N_DICT[lang] ? lang : 'en';
}

function readStoredLang() {
  try { return normalizeLang(localStorage.getItem('lang') || 'en'); }
  catch (e) { return 'en'; }
}

let currentLang = readStoredLang();

// Prefixes that appear inside longer composed sentences (e.g. fit reasons and
// salary metadata). translateDOM only matches whole text nodes, so these are
// replaced inside the string during lookup.
const I18N_PATTERNS = [
  ['Role keywords:', 'คำหลักตำแหน่ง:', '职位关键词：'],
  ['Skills:', 'ทักษะ:', '技能：'],
  ['Index:', 'ดัชนี:', '指数：'],
  ['Samples:', 'ตัวอย่าง:', '样本：'],
  ['Source:', 'แหล่งข้อมูล:', '来源：'],
  ['Only jobs with a profile match and a matching location are listed.', 'เฉพาะงานที่ตรงกับโปรไฟล์และสถานที่เท่านั้นที่แสดง', '仅显示与资料和地点均匹配的职位'],
  ['Active location:', 'สถานที่ที่ใช้งาน:', '当前地点：'],
  ['Matching against:', 'จับคู่กับ:', '匹配条件：'],
  ['Detected region:', 'ภูมิภาคที่ตรวจพบ:', '检测到的地区：'],
  ['Discovered jobs matching your profile', 'งานที่ค้นพบซึ่งตรงกับโปรไฟล์ของคุณ', '发现的匹配职位'],
  ['location-matched jobs that also match your profile. Best matches are listed first.', 'งานที่ตรงตามสถานที่และโปรไฟล์ เรียงตามความเหมาะสมมากไปน้อย', '地点和资料均匹配的职位，按匹配度排序'],
  ['Salary Data (', 'ข้อมูลเงินเดือน (', '薪资数据（'],
  ['Priorities (', 'ลำดับความสำคัญ (', '优先级（'],
  ['Priority ', 'ลำดับที่ ', '优先级 '],
  ['Profile:', 'โปรไฟล์:', '资料：'],
  ['AI is active for Apply Workflow tailoring and Interview Prep. Model:', 'AI ทำงานสำหรับการปรับแต่งเรซูเม่และเตรียมสัมภาษณ์แล้ว โมเดล:', 'AI 已用于申请流程定制简历和面试准备。模型：'],
  ['OpenAI, Azure, Anthropic, OpenRouter...', 'OpenAI, Azure, Anthropic, OpenRouter...', 'OpenAI、Azure、Anthropic、OpenRouter...'],
  ['gpt-4o-mini, gpt-4-turbo, claude-3-haiku...', 'gpt-4o-mini, gpt-4-turbo, claude-3-haiku...', 'gpt-4o-mini、gpt-4-turbo、claude-3-haiku...'],
  ['sk-... or your API key', 'sk-... หรือคีย์ API ของคุณ', 'sk-... 或你的 API 密钥'],
  ['https://api.openai.com/v1 (leave blank for default)', 'https://api.openai.com/v1 (เว้นว่างไว้เพื่อใช้ค่าเริ่มต้น)', 'https://api.openai.com/v1（留空使用默认值）'],
  ['e.g. Acme Corp', 'เช่น Acme Corp', '例如 Acme Corp'],
  ['e.g. Import Export Manager', 'เช่น Import Export Manager', '例如 Import Export Manager'],
  ['e.g. My Local Jobs', 'เช่น My Local Jobs', '例如 My Local Jobs'],
  ['e.g. Python, Data Scientist, Engineer', 'เช่น Python, Data Scientist, Engineer', '例如 Python、Data Scientist、Engineer'],
  ['e.g. Senior Data Scientist', 'เช่น Senior Data Scientist', '例如 Senior Data Scientist'],
];

function i18nLookup(key) {
  if (typeof key !== 'string') return key;
  const dict = I18N_DICT[currentLang] || {};
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  if (currentLang === 'en') return key;
  let translated = key;
  for (const [source, th, cn] of I18N_PATTERNS) {
    if (!translated.includes(source)) continue;
    const replacement = currentLang === 'th' ? th : cn;
    translated = translated.split(source).join(replacement);
  }
  return translated;
}

/** Translate a UI string. Safe for non-string values. */
function tr(value) {
  return i18nLookup(value);
}

/** alert() with a translated message (native dialogs bypass the DOM observer). */
function tAlert(message) {
  const text = typeof message === 'string' ? i18nLookup(message) : String(message);
  return typeof alert === 'function' ? alert(text) : undefined;
}

const i18nOriginals = new WeakMap();
const i18nAttrs = ['title', 'aria-label', 'placeholder'];

function nodeOriginal(node) {
  let entry = i18nOriginals.get(node);
  if (!entry) { entry = {}; i18nOriginals.set(node, entry); }
  return entry;
}

function translateTextNode(node) {
  const parent = node.parentElement;
  if (parent && /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(parent.tagName)) return;
  const source = node.nodeValue;
  if (!source || !source.trim()) return;
  const entry = nodeOriginal(node);
  if (entry.text === undefined) entry.text = source;
  const translated = i18nLookup(entry.text.trim());
  if (translated !== entry.text.trim()) {
    const leading = entry.text.match(/^\s*/)[0];
    const trailing = entry.text.match(/\s*$/)[0];
    node.nodeValue = leading + translated + trailing;
  } else {
    node.nodeValue = entry.text;
  }
}

function translateElement(node) {
  i18nAttrs.forEach(attr => {
    if (!node.hasAttribute || !node.hasAttribute(attr)) return;
    const source = node.getAttribute(attr);
    if (!source || !source.trim()) return;
    const entry = nodeOriginal(node);
    const key = 'attr:' + attr;
    if (entry[key] === undefined) entry[key] = source;
    node.setAttribute(attr, i18nLookup(entry[key]));
  });
}

function translateDOM(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    else translateElement(node);
  }
}

let i18nMutating = false;
function setLanguage(lang) {
  const next = normalizeLang(lang);
  currentLang = next;
  try { localStorage.setItem('lang', next); } catch (e) { /* storage disabled */ }
  document.documentElement.lang = next === 'cn' ? 'zh-CN' : next;
  i18nMutating = true;
  translateDOM(document);
  i18nMutating = false;
  const select = document.getElementById('language-select');
  if (select) select.value = next;
  // Re-render the active page so every tr()-wrapped label uses the new language
  // immediately, including content that was generated after page load.
  if (typeof window.renderPage === 'function') {
    setTimeout(() => { try { window.renderPage(); } catch (e) { /* ignore */ } }, 0);
  }
}

function initI18n() {
  const lang = readStoredLang();
  currentLang = lang;
  document.documentElement.lang = lang === 'cn' ? 'zh-CN' : lang;
  i18nMutating = true;
  translateDOM(document);
  i18nMutating = false;
  const select = document.getElementById('language-select');
  if (select) select.value = lang;
}

if (typeof document !== 'undefined' && document.body) {
  new MutationObserver(mutations => {
    if (i18nMutating) return;
    i18nMutating = true;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) translateDOM(node);
      });
    });
    i18nMutating = false;
  }).observe(document.body, { childList: true, subtree: true });
}

window.I18N = {
  L: i18nLookup,
  t: tr,
  current: () => currentLang,
};
window.tr = tr;
window.tAlert = tAlert;
window.i18nLookup = i18nLookup;
window.translateDOM = translateDOM;
window.setLanguage = setLanguage;
window.initI18n = initI18n;
