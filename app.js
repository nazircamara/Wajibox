"use strict";

const SUPABASE_URL = "https://toceezswxlzphzgsfefz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bB6c2MFILXX3bqpKTHdhOA_xnwBMdhc";
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/**
 * Storage Keys & In-Memory State
 */
const HOMEWORK_KEY = "homework_hub_homework";
const SUBMISSIONS_KEY = "homework_hub_submissions";
const ROLE_KEY = "homework_hub_role";
const STUDENT_KEY = "homework_hub_student";
const TEACHER_KEY = "homework_hub_teacher";
const TEACHER_CODE_KEY = "homework_hub_teacher_code";
const STUDENT_CLASS_CODE_KEY = "homework_hub_student_class_code";
const LANGUAGE_KEY = "homework_hub_language";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

let language = localStorage.getItem(LANGUAGE_KEY) || "en";
let role = localStorage.getItem(ROLE_KEY) || "student";
let currentView = role === "teacher" ? "teacher" : "student";
let activeQuiz = null;
let activeQuestionIndex = 0;
let quizAnswers = [];
let studentName = localStorage.getItem(STUDENT_KEY) || "";
let teacherName = localStorage.getItem(TEACHER_KEY) || "";
let teacherCode = getOrCreateTeacherCode();
if (teacherName) {
  const activeTeacherCodeKey = getTeacherCodeKey(teacherName);
  if (!normalizeClassCode(localStorage.getItem(activeTeacherCodeKey))) {
    localStorage.setItem(activeTeacherCodeKey, teacherCode);
  }
}
let studentClassCode = normalizeClassCode(localStorage.getItem(STUDENT_CLASS_CODE_KEY) || "");
let studentFilter = "pending";
let lastSubmission = null;
let currentPlaybackAudio = null;

/**
 * Pluggable Database Service Layer (Supabase / Firebase / LocalStorage)
 */
function readLocalHomework() {
  try {
    const data = localStorage.getItem(HOMEWORK_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Unable to read cached homework.", error);
    return [];
  }
}

function writeLocalHomework(items) {
  try {
    localStorage.setItem(HOMEWORK_KEY, JSON.stringify(items));
  } catch (error) {
    console.error("Unable to cache homework locally.", error);
  }
}

function readLocalSubmissions() {
  try {
    const data = localStorage.getItem(SUBMISSIONS_KEY);
    const parsed = data ? JSON.parse(data) : [];
    return parsed
      .map((item) => ({
        ...item,
        score: Number(item.score) || 0,
        total: Number(item.total) || 0,
        answers: Array.isArray(item.answers) ? item.answers.map(Number) : []
      }))
      .filter((item) => String(item.studentName || "").trim() && item.total > 0);
  } catch (error) {
    console.error("Unable to read cached submissions.", error);
    return [];
  }
}

function writeLocalSubmissions(items) {
  try {
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(items));
  } catch (error) {
    console.error("Unable to cache submissions locally.", error);
  }
}

function mapHomeworkRow(row) {
  return {
    ...row,
    id: row.id,
    dueDate: row.due_date ?? row.dueDate,
    teacherName: row.teacher_name ?? row.teacherName,
    classCode: row.class_code ?? row.classCode,
    createdAt: row.created_at ?? row.createdAt,
    questions: Array.isArray(row.questions) ? row.questions : []
  };
}

function mapHomeworkItem(item) {
  return {
    id: item.id,
    title: item.title,
    subject: item.subject,
    due_date: item.dueDate ?? item.due_date,
    teacher_name: item.teacherName ?? item.teacher_name,
    class_code: item.classCode ?? item.class_code,
    created_at: item.createdAt ?? item.created_at,
    questions: item.questions ?? []
  };
}

function mapSubmissionRow(row) {
  return {
    ...row,
    id: row.id,
    homeworkId: row.homework_id ?? row.homeworkId,
    studentName: row.student_name ?? row.studentName,
    score: Number(row.score) || 0,
    total: Number(row.total) || 0,
    date: row.date,
    answers: Array.isArray(row.answers) ? row.answers.map(Number) : []
  };
}

function mapSubmissionItem(item) {
  return {
    id: item.id,
    homework_id: item.homeworkId ?? item.homework_id,
    student_name: item.studentName ?? item.student_name,
    score: Number(item.score) || 0,
    total: Number(item.total) || 0,
    date: item.date,
    answers: Array.isArray(item.answers) ? item.answers : []
  };
}

const DatabaseService = {
  async getHomework() {
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("homework")
          .select("*")
          .order("created_at", { ascending: false });
        if (!error && Array.isArray(data)) {
          const items = data.map(mapHomeworkRow);
          writeLocalHomework(items);
          return items;
        }
        if (error) console.error("Unable to fetch homework from Supabase.", error);
      }
    } catch (error) {
      console.error("Unable to reach Supabase for homework.", error);
    }
    return readLocalHomework();
  },
  async saveHomework(items) {
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("homework")
          .upsert(items.map(mapHomeworkItem), { onConflict: "id" })
          .select();
        if (!error && Array.isArray(data)) {
          const savedItems = data.map(mapHomeworkRow);
          writeLocalHomework(savedItems);
          return savedItems;
        }
        if (error) console.error("Unable to save homework to Supabase.", error);
      }
    } catch (error) {
      console.error("Unable to reach Supabase for homework.", error);
    }
    writeLocalHomework(items);
    return items;
  },
  async createHomework(newItem) {
    try {
      if (supabaseClient) {
        const payload = mapHomeworkItem(newItem);
        const { data, error } = await supabaseClient
          .from("homework")
          .insert([payload])
          .select();

        if (error) {
          console.error("Supabase insert error:", error);
          showToast(error.message);
        } else if (Array.isArray(data) && data.length) {
          const saved = mapHomeworkRow(data[0]);
          const current = readLocalHomework();
          writeLocalHomework([saved, ...current.filter((h) => h.id !== saved.id)]);
          return saved;
        }
      }
    } catch (error) {
      console.error("Unable to reach Supabase to create homework.", error);
    }

    const cached = readLocalHomework();
    writeLocalHomework([newItem, ...cached.filter((item) => item.id !== newItem.id)]);
    return newItem;
  },
  async deleteHomework(id) {
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient
          .from("homework")
          .delete()
          .eq("id", id);
        if (error) console.error("Unable to delete homework from Supabase.", error);
      }
    } catch (error) {
      console.error("Unable to delete homework from Supabase.", error);
    }

    const current = readLocalHomework();
    writeLocalHomework(current.filter((item) => item.id !== id));
    return true;
  },
  async getSubmissions() {
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("submissions")
          .select("*")
          .order("date", { ascending: false });
        if (!error && Array.isArray(data)) {
          const submissions = data.map(mapSubmissionRow)
            .filter((item) => String(item.studentName || "").trim() && item.total > 0);
          writeLocalSubmissions(submissions);
          return submissions;
        }
        if (error) console.error("Unable to fetch submissions from Supabase.", error);
      }
    } catch (error) {
      console.error("Unable to reach Supabase for submissions.", error);
    }
    return readLocalSubmissions();
  },
  async addSubmission(submission) {
    try {
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("submissions")
          .upsert([mapSubmissionItem(submission)], { onConflict: "id" })
          .select()
          .single();
        if (!error && data) {
          const savedSubmission = mapSubmissionRow(data);
          const cached = readLocalSubmissions();
          writeLocalSubmissions([
            ...cached.filter((item) => item.id !== savedSubmission.id),
            savedSubmission
          ]);
          return savedSubmission;
        }
        if (error) console.error("Unable to save submission to Supabase.", error);
      }
    } catch (error) {
      console.error("Unable to reach Supabase for submissions.", error);
    }
    const subs = readLocalSubmissions();
    const updated = [
      ...subs.filter((s) => !(s.homeworkId === submission.homeworkId && s.studentName === submission.studentName)),
      submission
    ];
    writeLocalSubmissions(updated);
    return submission;
  },
  async clearAllSubmissions() {
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.from("submissions").delete().neq("id", "");
        if (error) console.error("Unable to clear submissions in Supabase.", error);
        else {
          writeLocalSubmissions([]);
          return true;
        }
      }
    } catch (error) {
      console.error("Unable to reach Supabase to clear submissions.", error);
    }
    writeLocalSubmissions([]);
    return true;
  },
  async clearAllData() {
    try {
      if (supabaseClient) {
        const submissionsResult = await supabaseClient.from("submissions").delete().neq("id", "");
        const homeworkResult = await supabaseClient.from("homework").delete().neq("id", "");
        if (submissionsResult.error) console.error("Unable to clear Supabase submissions.", submissionsResult.error);
        if (homeworkResult.error) console.error("Unable to clear Supabase homework.", homeworkResult.error);
        if (!submissionsResult.error && !homeworkResult.error) {
          writeLocalSubmissions([]);
          writeLocalHomework([]);
          return true;
        }
      }
    } catch (error) {
      console.error("Unable to reach Supabase to clear data.", error);
    }
    writeLocalSubmissions([]);
    writeLocalHomework([]);
    return true;
  }
};

/**
 * Audio Recording & Speech Synthesis Utilities
 */
const VoiceSystem = {
  activeRecorder: null,
  activeStream: null,

  async startRecording(onSuccess, onError) {
    try {
      this.activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(this.activeStream);
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => onSuccess(reader.result);
        reader.readAsDataURL(blob);
        if (this.activeStream) {
          this.activeStream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start();
      this.activeRecorder = mediaRecorder;
    } catch (err) {
      if (onError) onError(err);
    }
  },

  stopRecording() {
    if (this.activeRecorder && this.activeRecorder.state !== "inactive") {
      this.activeRecorder.stop();
    }
  },

  stopAllPlayback() {
    if (currentPlaybackAudio) {
      currentPlaybackAudio.pause();
      currentPlaybackAudio = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  },

  playOrSpeak(audioDataUrl, fallbackText, lang = "en") {
    this.stopAllPlayback();
    if (audioDataUrl) {
      currentPlaybackAudio = new Audio(audioDataUrl);
      currentPlaybackAudio.play();
    } else if (fallbackText && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(fallbackText);
      utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }
};

/**
 * Localization Dictionary
 */
const translations = {
  en: {
    brand: "Wajibox", studentMode: "Student", teacherMode: "Teacher", arabic: "العربية", english: "English",
    studentWorkspace: "Student workspace", teacherWorkspace: "Teacher workspace", goodMorning: "Welcome, {name}.", studentSubtitle: "Stay on top of your learning. Your next win is waiting below.", switchStudent: "Save name", classCode: "Class Code", enterClassCode: "Enter Class Code", joinClass: "Join Class", copyCode: "Copy Code", codeCopied: "Class code copied to clipboard!", noClassCodePrompt: "Enter your teacher's class code above to view your assignments.",
    assigned: "Assigned to you", completed: "Completed", acrossClasses: "Across your classes", steadyProgress: "Steady progress", nextDue: "Next due", momentum: "Keep your momentum", today: "Today", days: "{n}d", yourHomework: "Your homework", pending: "Pending", nothingHere: "Nothing here yet", checkBack: "Check back after your teacher publishes an assignment.", notStarted: "Not started", questions: "questions", due: "Due {date}", ready: "Ready when you are", start: "Start assignment", reviewResults: "Review results", submitted: "Submitted {date}", studentName: "Student name", studentPlaceholder: "Enter your name", nameRequired: "Please enter your name first.",
    buildPractice: "Build better practice.", teacherSubtitle: "Create focused homework, publish it in seconds, and track class progress.", newAssignment: "+ New assignment", published: "Published assignments", liveAssignment: "1 live assignment", liveAcross: "Live across classes", submissions: "Total submissions", allStudents: "Across all students", average: "Class average", feedback: "Class performance", assignmentLibrary: "Assignment library", selectAssignment: "Inspect assigned work and review answers.", classPulse: "Class pulse", recentWork: "A quick look at recent student submissions.", emptyLibrary: "Your library is empty", createFirst: "Create your first assignment to get started.", noSubmissions: "No submissions yet", resultsShow: "Student results will show up here after submission.", submission: "submission", publishedOn: "Published {date}", delete: "Delete", viewAnswers: "View answers", backDashboard: "Back to dashboard",
    createAssignment: "Create an assignment.", createSubtitle: "Give students clear questions and voice guidance.", newLabel: "Teacher workspace / new", assignmentDetails: "Assignment details", fieldsSaved: "Fields save when you publish.", title: "Assignment title", titlePlaceholder: "e.g. Science Checkpoint", subject: "Subject", subjectPlaceholder: "Science", dueDate: "Due date", addQuestion: "+ Add question", publish: "Publish homework", checklist: "Publishing checklist", checklistHelp: "A quick check before students take this.", checklistText: "Strong assignments offer clear text and audio for easy listening.", answerChoices: "Answer choices", perQuestion: "4 per question", grading: "Grading", automatic: "Automatic", questionText: "Question text", questionPlaceholder: "Write a clear question", answerPlaceholder: "Option {letter}", remove: "Remove", questionNumber: "Question {n}",
    quizPrompt: "Listen or read carefully, then choose your answer.", questionCounter: "Question {current} of {total}", selectAnswer: "Select an answer to continue.", answerSaved: "Answer recorded.", previous: "Previous", next: "Next question", submit: "Submit homework", chooseAnswer: "Please choose an answer.", unanswered: "Please answer all questions before submitting.", submitConfirm: "Submit homework now?",
    submissionComplete: "Submission complete", passedHeadline: "You passed. Nice work!", reviewHeadline: "Keep practicing. You are getting there.", feedbackFor: "Here is your feedback for {title}.", backHomework: "Back to homework", finalScore: "Final score", correctAnswers: "Correct answers", result: "Result", passed: "Passed", failed: "Failed", review: "Review", reviewAnswers: "Review your answers", passingScore: "Passing score", morePractice: "Needs practice", yourAnswer: "Your answer", correctAnswer: "Correct answer", correctMessage: "Correct! Keep up the great work.", wrongMessage: "The correct choice was {answer}.",
    resultsWorkspace: "Teacher workspace / results", dueLabel: "Due {date}", tracker: "Submission tracker", received: "{n} submissions received", classAverage: "{n}% class average", noStudent: "No student submissions yet", shareAssignment: "Share the assignment with your class.", student: "Student", submittedAt: "Submitted {date}", studentReview: "Student review", close: "Close", correct: "Correct",
    teacherName: "Teacher name", teacherPlaceholder: "Enter teacher name", switchTeacher: "Save name", teacherWelcome: "Welcome, {name}.", clearSubmissions: "Clear submissions", confirmClearSubmissions: "Clear all assignments and student submissions? This cannot be undone.", dashboardClearedToast: "All assignments and submissions cleared.", publishedToast: "Assignment published!", deletedToast: "Assignment deleted.", deleteConfirm: "Delete {title}?", completeDetails: "Please fill in title, subject, and due date.", questionBlank: "Add text to every question.", optionsMissing: "Fill all 4 answer options.", correctMissing: "Select the correct radio choice.",
    recordQuestionAudio: "Record Question", recordOptionAudio: "Record Audio", recordingState: "Recording...", stopRecordingState: "Stop", audioRecorded: "Voice recorded", playAudio: "Listen", readAloud: "Read Aloud", deleteAudio: "Remove Voice", micPermissionDenied: "Microphone permission is required to record voice audio.", renderError: "This view could not be loaded.", refreshPage: "Please refresh the page and try again."
  },
  ar: {
    brand: "واجيبوكس", studentMode: "الطالب", teacherMode: "المعلم", arabic: "العربية", english: "English",
    studentWorkspace: "مساحة الطالب", teacherWorkspace: "مساحة المعلم", goodMorning: "مرحباً، {name}.", studentSubtitle: "تابع تقدمك الدراسي، وإنجازك القادم بانتظارك هنا.", switchStudent: "حفظ الاسم", classCode: "رمز الصف", enterClassCode: "أدخل رمز الصف", joinClass: "انضمام للصف", copyCode: "نسخ الرمز", codeCopied: "تم نسخ رمز الصف بنجاح!", noClassCodePrompt: "أدخل رمز الصف الخاص بمعلمك أعلاه لعرض واجباتك.",
    assigned: "الواجبات المعيّنة", completed: "المكتملة", acrossClasses: "في جميع موادك", steadyProgress: "تقدم مستمر", nextDue: "أقرب موعد", momentum: "واصل تقدمك", today: "اليوم", days: "{n} يوم", yourHomework: "واجباتك", pending: "قيد الانتظار", nothingHere: "لا توجد واجبات هنا", checkBack: "عد لاحقاً بعد أن ينشر المعلم واجباً جديداً.", notStarted: "لم يبدأ", questions: "أسئلة", due: "التسليم {date}", ready: "جاهز للبدء", start: "بدء الواجب", reviewResults: "مراجعة النتائج", submitted: "أُرسل {date}", studentName: "اسم الطالب", studentPlaceholder: "أدخل اسمك", nameRequired: "يرجى كتابة اسم الطالب أولاً.",
    buildPractice: "أنشئ تدريباً أفضل.", teacherSubtitle: "أنشئ واجبات مركزة مع تسجيل صوتي وتابع مستوى الصف.", newAssignment: "+ واجب جديد", published: "الواجبات المنشورة", liveAssignment: "واجب واحد نشط", liveAcross: "منشورة لجميع الصفوف", submissions: "إجمالي التسليمات", allStudents: "لجميع الطلاب", average: "متوسط الصف", feedback: "أداء الصف", assignmentLibrary: "مكتبة الواجبات", selectAssignment: "اختر واجباً لمراجعة الإجابات والتسليمات.", classPulse: "نبض الصف", recentWork: "نظرة سريعة على أحدث تسليمات الطلاب.", emptyLibrary: "مكتبتك فارغة", createFirst: "أنشئ أول واجب للبدء.", noSubmissions: "لا توجد تسليمات بعد", resultsShow: "ستظهر نتائج الطلاب هنا بعد التسليم.", submission: "تسليم", publishedOn: "نُشر {date}", delete: "حذف", viewAnswers: "عرض الإجابات", backDashboard: "العودة للوحة التحكم",
    createAssignment: "أنشئ واجباً.", createSubtitle: "امنح طلابك أسئلة واضحة مع إمكانية القراءة الصوتية.", newLabel: "مساحة المعلم / جديد", assignmentDetails: "تفاصيل الواجب", fieldsSaved: "تُحفظ البيانات عند النشر.", title: "العنوان", titlePlaceholder: "مثال: مراجعة العلوم العامة", subject: "المادة", subjectPlaceholder: "العلوم", dueDate: "تاريخ التسليم", addQuestion: "+ إضافة سؤال", publish: "نشر الواجب", checklist: "قائمة التحقق", checklistHelp: "فحص سريع للجودة قبل النشر.", checklistText: "الواجب الجيد يحتوي نصوصاً واضحة وتسجيلات صوتية مساعدة.", answerChoices: "خيارات الإجابة", perQuestion: "4 لكل سؤال", grading: "التصحيح", automatic: "تلقائي", questionText: "نص السؤال", questionPlaceholder: "اكتب سؤالاً واضحاً", answerPlaceholder: "الخيار {letter}", remove: "حذف", questionNumber: "السؤال {n}",
    quizPrompt: "استمع أو اقرأ بتمعن، ثم اختر الإجابة المناسبة.", questionCounter: "السؤال {current} من {total}", selectAnswer: "اختر إجابة للمتابعة.", answerSaved: "تم تسجيل الإجابة.", previous: "السابق", next: "التالي", submit: "إرسال الواجب", chooseAnswer: "اختر إجابة أولاً.", unanswered: "يرجى الإجابة عن جميع الأسئلة قبل الإرسال.", submitConfirm: "هل تريد إرسال الواجب الآن؟",
    submissionComplete: "اكتمل التسليم", passedHeadline: "مبروك! لقد اجتزت الاختبار بنجاح.", reviewHeadline: "واصل التدريب، ستحقق نتيجة أفضل قريباً.", feedbackFor: "إليك نتائجك في {title}.", backHomework: "العودة للواجبات", finalScore: "الدرجة النهائية", correctAnswers: "الإجابات الصحيحة", result: "النتيجة", passed: "ناجح", failed: "راسب", review: "مراجعة", reviewAnswers: "راجع إجاباتك", passingScore: "درجة النجاح", morePractice: "بحاجة لتدريب", yourAnswer: "إجابتك", correctAnswer: "الإجابة الصحيحة", correctMessage: "إجابة صحيحة وممتازة!", wrongMessage: "الإجابة الصحيحة هي {answer}.",
    resultsWorkspace: "مساحة المعلم / النتائج", dueLabel: "التسليم {date}", tracker: "متابعة التسليمات", received: "تم استلام {n} تسليمات", classAverage: "متوسط الصف {n}%", noStudent: "لا توجد تسليمات بعد", shareAssignment: "شارك الواجب مع طلابك لبدء جمع الإجابات.", student: "الطالب", submittedAt: "أُرسل {date}", studentReview: "مراجعة إجابات الطالب", close: "إغلاق", correct: "صحيح",
    teacherName: "اسم المعلم", teacherPlaceholder: "أدخل اسم المعلم", switchTeacher: "حفظ الاسم", teacherWelcome: "مرحباً، {name}.", clearSubmissions: "مسح التسليمات", confirmClearSubmissions: "هل تريد مسح جميع الواجبات وتسليمات الطلاب؟ لا يمكن التراجع عن هذا الإجراء.", dashboardClearedToast: "تم مسح جميع الواجبات والتسليمات بنجاح.", publishedToast: "تم نشر الواجب بنجاح!", deletedToast: "تم حذف الواجب.", deleteConfirm: "هل أنت متأكد من حذف {title}؟", completeDetails: "يرجى ملء العنوان والمادة وتاريخ التسليم.", questionBlank: "يرجى كتابة نص لكل سؤال.", optionsMissing: "يرجى ملء خيارات الإجابة الأربعة.", correctMissing: "يرجى اختيار الإجابة الصحيحة.",
    recordQuestionAudio: "تسجيل صوتي للسؤال", recordOptionAudio: "تسجيل صوتي", recordingState: "جارٍ التسجيل...", stopRecordingState: "إيقاف", audioRecorded: "تم التسجيل", playAudio: "استمع", readAloud: "قراءة آلية", deleteAudio: "حذف الصوت", micPermissionDenied: "يرجى منح إذن استخدام الميكروفون لتسجيل الصوت.", renderError: "تعذر تحميل هذه الصفحة.", refreshPage: "يرجى تحديث الصفحة والمحاولة مرة أخرى."
  }
};

const letters = { en: ["A", "B", "C", "D"], ar: ["أ", "ب", "ج", "د"] };

function normalizeClassCode(code) {
  return String(code || "").trim().toUpperCase();
}

function getOrCreateTeacherCode() {
  const storedCode = normalizeClassCode(localStorage.getItem(TEACHER_CODE_KEY));
  if (storedCode) return storedCode;
  const generatedCode = `WJB-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
  localStorage.setItem(TEACHER_CODE_KEY, generatedCode);
  return generatedCode;
}

function getTeacherCodeKey(name) {
  return `${TEACHER_CODE_KEY}_${String(name).trim().toLowerCase()}`;
}

function createTeacherCode() {
  return `WJB-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

function t(key, values = {}) {
  let text = translations[language]?.[key] || translations.en[key] || key;
  Object.keys(values).forEach((name) => {
    text = text.replaceAll(`{${name}}`, values[name]);
  });
  return text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function initials(name) {
  return String(name || "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

function getFutureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getAverageScore(submissions) {
  if (!submissions.length) return 0;
  const sum = submissions.reduce((total, s) => total + (s.score / s.total) * 100, 0);
  return Math.round(sum / submissions.length);
}

async function initializeDefaultData() {
  // Clean up legacy localStorage seed if present
  try {
    const raw = localStorage.getItem(HOMEWORK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw).filter((item) => item.id !== "science-seed");
      localStorage.setItem(HOMEWORK_KEY, JSON.stringify(parsed));
    }
  } catch (err) {
    console.warn("Storage check failed:", err);
  }
}

/**
 * Topbar & Global View Controllers
 */
function setLanguage(next) {
  VoiceSystem.stopAllPlayback();
  language = next;
  localStorage.setItem(LANGUAGE_KEY, language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  render();
}

function setRole(next) {
  VoiceSystem.stopAllPlayback();
  role = next;
  currentView = next;
  localStorage.setItem(ROLE_KEY, role);
  render();
}

async function render() {
  const brandName = document.querySelector("#brand-name");
  const userChip = document.querySelector("#user-chip");
  const languageToggle = document.querySelector("#language-toggle");

  if (brandName) brandName.textContent = t("brand");
  if (userChip) {
    userChip.textContent = role === "teacher"
      ? (teacherName || t("teacherMode"))
      : (studentName || t("studentMode"));
  }
  if (languageToggle) {
    languageToggle.textContent = language === "ar" ? t("english") : t("arabic");
  }

  document.querySelectorAll(".role-button").forEach((btn) => {
    btn.textContent = t(btn.dataset.role === "student" ? "studentMode" : "teacherMode");
    btn.classList.toggle("active", btn.dataset.role === role);
    btn.setAttribute("aria-pressed", String(btn.dataset.role === role));
  });

  try {
    if (currentView === "teacher") await renderTeacher();
    else if (currentView === "quiz") renderQuiz();
    else if (currentView === "results") await renderResults();
    else await renderStudent();
  } catch (error) {
    console.error("Unable to render the current view.", error);
    if (app) {
      app.innerHTML = `
        <section class="empty-state">
          <h3>${escapeHtml(t("renderError"))}</h3>
          <p>${escapeHtml(t("refreshPage"))}</p>
        </section>
      `;
    }
  }
}

/**
 * Student Workspace Views
 */
async function renderStudent() {
  const homework = await DatabaseService.getHomework();
  const submissions = await DatabaseService.getSubmissions();
  const classHomework = studentClassCode
    ? homework.filter((item) => normalizeClassCode(item.classCode) === studentClassCode)
    : [];
  const completedCount = classHomework.filter((item) => submissions.some((s) => s.homeworkId === item.id && s.studentName === studentName)).length;
  const visible = classHomework.filter((item) => {
    const isDone = submissions.some((s) => s.homeworkId === item.id && s.studentName === studentName);
    return studentFilter === "completed" ? isDone : !isDone;
  });

  app.innerHTML = `
    <section class="page-heading">
      <div>
        <div class="eyebrow">${t("studentWorkspace")}</div>
        <h1>${t("goodMorning", { name: escapeHtml((studentName || t("studentMode")).split(" ")[0]) })}</h1>
        <p class="subtitle">${t("studentSubtitle")}</p>
      </div>
      <div class="student-entry">
        <label for="student-name">${t("studentName")}</label>
        <input id="student-name" value="${escapeHtml(studentName)}" placeholder="${t("studentPlaceholder")}" />
        <button class="button button-ghost button-small" id="change-student" type="button">${t("switchStudent")}</button>
      </div>
    </section>

    <section class="class-code-input-bar" aria-label="${t("classCode")}">
      <div class="class-code-input-copy">
        <div class="eyebrow">${t("classCode")}</div>
        <p>${t("enterClassCode")}</p>
      </div>
      <div class="class-code-entry">
        <label class="sr-only" for="student-class-code">${t("enterClassCode")}</label>
        <input id="student-class-code" maxlength="7" value="${escapeHtml(studentClassCode)}" placeholder="${t("enterClassCode")}" autocomplete="off" />
        <button class="button button-primary button-small" id="join-class" type="button">${t("joinClass")}</button>
      </div>
    </section>

    <section class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">${t("assigned")}</div>
        <div class="metric-value">${classHomework.length}</div>
        <div class="metric-note">${t("acrossClasses")}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${t("completed")}</div>
        <div class="metric-value">${completedCount}</div>
        <div class="metric-note">${t("steadyProgress")}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${t("nextDue")}</div>
        <div class="metric-value">${getNextDue(classHomework, submissions)}</div>
        <div class="metric-note">${t("momentum")}</div>
      </div>
    </section>

    <section>
      <div class="section-bar">
        <h2>${t("yourHomework")}</h2>
        <div class="filter-tabs">
          <button class="filter-tab ${studentFilter === "pending" ? "active" : ""}" data-filter="pending" type="button">${t("pending")}</button>
          <button class="filter-tab ${studentFilter === "completed" ? "active" : ""}" data-filter="completed" type="button">${t("completed")}</button>
        </div>
      </div>
      <div class="assignment-list">
        ${visible.length
          ? visible.map((item) => renderStudentCard(item, submissions)).join("")
          : `<div class="empty-state"><h3>${t("nothingHere")}</h3><p>${studentClassCode ? t("checkBack") : t("noClassCodePrompt")}</p></div>`}
      </div>
    </section>
  `;

  const saveStudentClassCode = () => {
    studentClassCode = normalizeClassCode(document.querySelector("#student-class-code").value);
    localStorage.setItem(STUDENT_CLASS_CODE_KEY, studentClassCode);
    renderStudent();
  };
  document.querySelector("#join-class").addEventListener("click", saveStudentClassCode);
  document.querySelector("#student-class-code").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase();
  });
  document.querySelector("#student-class-code").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveStudentClassCode();
  });

  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { studentFilter = b.dataset.filter; renderStudent(); }));
  document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => startQuiz(b.dataset.start)));
  document.querySelectorAll("[data-results]").forEach((b) => b.addEventListener("click", async () => {
    const list = await DatabaseService.getHomework();
    activeQuiz = list.find((h) => h.id === b.dataset.results);
    currentView = "results";
    renderResults();
  }));
  document.querySelector("#change-student").addEventListener("click", () => {
    const input = document.querySelector("#student-name").value.trim();
    if (input) {
      studentName = input;
      localStorage.setItem(STUDENT_KEY, studentName);
      render();
    }
  });
}

function getNextDue(homework, submissions) {
  const pending = homework.filter((item) => !submissions.some((s) => s.homeworkId === item.id && s.studentName === studentName)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!pending.length) return "-";
  const days = Math.ceil((new Date(`${pending[0].dueDate}T12:00:00`) - new Date()) / 86400000);
  return days <= 0 ? t("today") : t("days", { n: days });
}

function renderStudentCard(item, submissions) {
  const sub = submissions.find((s) => s.homeworkId === item.id && s.studentName === studentName);
  return `
    <article class="assignment-card">
      <div>
        <div class="card-top">
          <div>
            <div class="eyebrow">${escapeHtml(item.subject)}</div>
            <h3>${escapeHtml(item.title)}</h3>
          </div>
          <span class="badge ${sub ? "badge-complete" : "badge-pending"}">
            ${sub ? `${t("completed")} · ${sub.score}/${sub.total}` : t("notStarted")}
          </span>
        </div>
        <div class="card-meta">
          <span>${item.questions.length} ${t("questions")}</span>
          <span>${t("due", { date: formatDate(item.dueDate) })}</span>
          ${item.teacherName ? `<span>${escapeHtml(item.teacherName)}</span>` : ""}
        </div>
      </div>
      <div class="card-footer">
        ${sub ? `<span class="helper">${t("submitted", { date: formatDateTime(sub.date) })}</span><button class="button button-secondary button-small" data-results="${item.id}" type="button">${t("reviewResults")}</button>` : `<span class="helper">${t("ready")}</span><button class="button button-primary button-small" data-start="${item.id}" type="button">${t("start")}</button>`}
      </div>
    </article>
  `;
}

/**
 * Quiz Engine with Audio Separation & Name Guard
 */
async function startQuiz(homeworkId) {
  const homework = await DatabaseService.getHomework();
  activeQuiz = homework.find((item) => item.id === homeworkId);
  if (!activeQuiz) return;

  const currentInput = document.querySelector("#student-name")?.value.trim();
  if (currentInput) {
    studentName = currentInput;
    localStorage.setItem(STUDENT_KEY, studentName);
  }

  // Name Validation Guard
  if (!studentName.trim()) {
    showToast(t("nameRequired"));
    document.querySelector("#student-name")?.focus();
    return;
  }

  activeQuestionIndex = 0;
  quizAnswers = Array(activeQuiz.questions.length).fill(null);
  currentView = "quiz";
  render();
}

function renderQuiz() {
  const q = activeQuiz.questions[activeQuestionIndex];
  const selected = quizAnswers[activeQuestionIndex];
  const progress = ((activeQuestionIndex + 1) / activeQuiz.questions.length) * 100;

  app.innerHTML = `
    <div class="quiz-wrap">
      <div class="quiz-card">
        <div class="quiz-header">
          <div>
            <div class="eyebrow">${escapeHtml(activeQuiz.subject)} · ${escapeHtml(activeQuiz.title)}</div>
            <p>${t("quizPrompt")}</p>
          </div>
          <span class="badge badge-pending">${t("questionCounter", { current: activeQuestionIndex + 1, total: activeQuiz.questions.length })}</span>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>

        <div class="quiz-question">
          <div class="question-title-row">
            <h2>${escapeHtml(q.text)}</h2>
            <button class="audio-btn" id="listen-question" type="button">
              🔊 ${q.audio ? t("playAudio") : t("readAloud")}
            </button>
          </div>

          <div class="quiz-options">
            ${q.options.map((opt, i) => `
              <div class="quiz-option ${selected === i ? "selected" : ""}" data-choice-index="${i}">
                <label class="option-label-wrap" style="flex:1; cursor:pointer;">
                  <input type="radio" name="quiz-choice" value="${i}" ${selected === i ? "checked" : ""} />
                  <span>${escapeHtml(opt)}</span>
                </label>
                <button class="audio-btn option-listen-btn" type="button" data-index="${i}" title="${t("playAudio")}">
                  🔊
                </button>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="quiz-footer">
          <span class="helper">${selected === null ? t("selectAnswer") : t("answerSaved")}</span>
          <div class="inline-actions">
            <button class="button button-ghost" id="quiz-prev" type="button" ${activeQuestionIndex === 0 ? "disabled" : ""}>${t("previous")}</button>
            ${activeQuestionIndex === activeQuiz.questions.length - 1
              ? `<button class="button button-primary" id="quiz-submit" type="button">${t("submit")}</button>`
              : `<button class="button button-primary" id="quiz-next" type="button">${t("next")}</button>`}
          </div>
        </div>
      </div>
    </div>
  `;

  document.querySelector("#listen-question").addEventListener("click", () => {
    VoiceSystem.playOrSpeak(q.audio, q.text, language);
  });

  document.querySelectorAll(".option-listen-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      const optAudio = q.optionsAudio ? q.optionsAudio[idx] : null;
      VoiceSystem.playOrSpeak(optAudio, q.options[idx], language);
    });
  });

  document.querySelectorAll("input[name='quiz-choice']").forEach((radio) => {
    radio.addEventListener("change", () => {
      quizAnswers[activeQuestionIndex] = Number(radio.value);
      renderQuiz();
    });
  });

  document.querySelector("#quiz-prev").addEventListener("click", () => {
    VoiceSystem.stopAllPlayback();
    activeQuestionIndex--;
    renderQuiz();
  });

  document.querySelector("#quiz-next")?.addEventListener("click", () => {
    if (quizAnswers[activeQuestionIndex] === null) return showToast(t("chooseAnswer"));
    VoiceSystem.stopAllPlayback();
    activeQuestionIndex++;
    renderQuiz();
  });

  document.querySelector("#quiz-submit")?.addEventListener("click", submitQuiz);
}

async function submitQuiz() {
  if (quizAnswers.some((ans) => ans === null)) return alert(t("unanswered"));
  if (!confirm(t("submitConfirm"))) return;

  VoiceSystem.stopAllPlayback();
  const score = activeQuiz.questions.reduce((sum, q, i) => sum + (q.correctIndex === quizAnswers[i] ? 1 : 0), 0);
  const record = {
    id: `sub-${Date.now()}`,
    homeworkId: activeQuiz.id,
    studentName,
    score,
    total: activeQuiz.questions.length,
    date: new Date().toISOString(),
    answers: quizAnswers
  };

  await DatabaseService.addSubmission(record);
  lastSubmission = record;
  currentView = "results";
  renderResults();
}

async function renderResults() {
  const submissions = await DatabaseService.getSubmissions();
  const sub = submissions.find((s) => s.homeworkId === activeQuiz.id && s.studentName === studentName) || lastSubmission;
  if (!sub) return renderStudent();

  const percentage = Math.round((sub.score / sub.total) * 100);
  const passed = percentage >= 70;

  app.innerHTML = `
    <section class="page-heading results-card">
      <div>
        <div class="eyebrow">${t("submissionComplete")}</div>
        <h1>${passed ? t("passedHeadline") : t("reviewHeadline")}</h1>
        <p class="subtitle">${t("feedbackFor", { title: escapeHtml(activeQuiz.title) })}</p>
      </div>
      <button class="button button-secondary" id="back-home-btn" type="button">${t("backHomework")}</button>
    </section>

    <section class="panel results-card">
      <div class="result-summary">
        <div class="result-stat"><strong>${percentage}%</strong><span>${t("finalScore")}</span></div>
        <div class="result-stat"><strong>${sub.score}/${sub.total}</strong><span>${t("correctAnswers")}</span></div>
        <div class="result-stat"><strong>${passed ? t("passed") : t("review")}</strong><span>${t("result")}</span></div>
      </div>
      <div class="section-bar">
        <h2>${t("reviewAnswers")}</h2>
        <span class="badge ${passed ? "badge-passed" : "badge-failed"}">${passed ? t("passingScore") : t("morePractice")}</span>
      </div>
      <div class="review-list">
        ${activeQuiz.questions.map((q, i) => {
          const isCorrect = q.correctIndex === sub.answers[i];
          return `
            <article class="review-item">
              <h3>${i + 1}.${escapeHtml(q.text)}</h3>
              <div class="review-answer ${isCorrect ? "correct" : "wrong"}">
                <strong>${t("yourAnswer")}:</strong> ${escapeHtml(q.options[sub.answers[i]] ?? "-")}
              </div>
              ${!isCorrect ? `<div class="review-answer correct"><strong>${t("correctAnswer")}:</strong> ${escapeHtml(q.options[q.correctIndex])}</div>` : ""}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;

  document.querySelector("#back-home-btn").addEventListener("click", () => {
    currentView = "student";
    render();
  });
}

/**
 * Teacher Workspace & Creator Views
 */
async function renderTeacher() {
  const allHomework = await DatabaseService.getHomework();
  const homework = allHomework.filter((item) => normalizeClassCode(item.classCode) === normalizeClassCode(teacherCode));
  const allSubmissions = await DatabaseService.getSubmissions();
  const submissions = allSubmissions.filter((sub) => homework.some((hw) => hw.id === sub.homeworkId));

  app.innerHTML = `
    <section class="page-heading">
      <div>
        <div class="eyebrow">${t("teacherWorkspace")}</div>
        <h1>${t("teacherWelcome", { name: escapeHtml((teacherName || t("teacherMode")).split(" ")[0]) })}</h1>
        <p class="subtitle">${t("teacherSubtitle")}</p>
      </div>
      <div class="teacher-controls">
        <div class="class-code-badge">
          <div>
            <span class="class-code-label">${t("classCode")}</span>
            <strong>${escapeHtml(teacherCode)}</strong>
          </div>
          <button id="copy-class-code" class="class-code-copy" type="button" title="${t("copyCode")}" aria-label="${t("copyCode")}">📋</button>
        </div>
        <div class="student-entry">
          <label for="teacher-name">${t("teacherName")}</label>
          <input id="teacher-name" value="${escapeHtml(teacherName)}" placeholder="${t("teacherPlaceholder")}" />
          <button class="button button-ghost button-small" id="change-teacher" type="button">${t("switchTeacher")}</button>
        </div>
        <div class="inline-actions">
          <button class="button button-primary" id="new-assignment" type="button">${t("newAssignment")}</button>
          <button class="button button-danger button-small" id="clear-submissions" type="button">${t("clearSubmissions")}</button>
        </div>
      </div>
    </section>

    <section class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">${t("published")}</div>
        <div class="metric-value">${homework.length}</div>
        <div class="metric-note">${homework.length === 1 ? t("liveAssignment") : t("liveAcross")}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${t("submissions")}</div>
        <div class="metric-value">${submissions.length}</div>
        <div class="metric-note">${t("allStudents")}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${t("average")}</div>
        <div class="metric-value">${getAverageScore(submissions)}%</div>
        <div class="metric-note">${t("feedback")}</div>
      </div>
    </section>

    <div class="teacher-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${t("assignmentLibrary")}</h2>
            <p class="helper">${t("selectAssignment")}</p>
          </div>
        </div>
        <div>
          ${homework.length ? homework.map((item) => {
            const count = submissions.filter((s) => s.homeworkId === item.id).length;
            return `
              <div class="teacher-assignment">
                <div>
                  <strong>${escapeHtml(item.title)}${item.teacherName ? ` · <small class="helper">${escapeHtml(item.teacherName)}</small>` : ""}</strong>
                  <p>${escapeHtml(item.subject)} ·${item.questions.length} ${t("questions")} · ${t("publishedOn", { date: formatDate(item.createdAt?.slice(0, 10)) })}</p>
                </div>
                <div class="inline-actions">
                  <button class="button button-secondary button-small" data-track="${item.id}" type="button">${count}${t("submission")}</button>
                  <button class="button button-danger button-small" data-delete="${item.id}" type="button">${t("delete")}</button>
                </div>
              </div>
            `;
          }).join("") : `<div class="empty-state"><h3>${t("emptyLibrary")}</h3><p>${t("createFirst")}</p></div>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${t("classPulse")}</h2>
            <p class="helper">${t("recentWork")}</p>
          </div>
        </div>
        <div>
          ${submissions.length ? submissions.slice(-5).reverse().map((s) => `
            <div class="tracker-row">
              <div class="student-info">
                <span class="student-avatar">${initials(s.studentName)}</span>
                <div>
                  <strong>${escapeHtml(s.studentName)}</strong>
                  <small>${formatDateTime(s.date)}</small>
                </div>
              </div>
              <div class="score">
                ${s.score}/${s.total}
                <small>${Math.round((s.score / s.total) * 100)}%</small>
              </div>
            </div>
          `).join("") : `<div class="empty-state"><h3>${t("noSubmissions")}</h3><p>${t("resultsShow")}</p></div>`}
        </div>
      </section>
    </div>
  `;

  document.querySelector("#new-assignment").addEventListener("click", renderCreator);
  document.querySelector("#copy-class-code").addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(teacherCode);
      } else {
        const helper = document.createElement("textarea");
        helper.value = teacherCode;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      showToast(t("codeCopied"));
    } catch (error) {
      console.error("Unable to copy class code.", error);
    }
  });
  document.querySelector("#clear-submissions").addEventListener("click", async () => {
    if (!confirm(t("confirmClearSubmissions"))) return;
    await DatabaseService.clearAllData();
    showToast(t("dashboardClearedToast"));
    renderTeacher();
  });

  const saveTeacher = async () => {
    const val = document.querySelector("#teacher-name").value.trim();
    if (val) {
      const codeKey = getTeacherCodeKey(val);
      const storedCode = normalizeClassCode(localStorage.getItem(codeKey));
      teacherName = val;
      localStorage.setItem(TEACHER_KEY, teacherName);
      teacherCode = storedCode || createTeacherCode();
      localStorage.setItem(codeKey, teacherCode);
      const userChip = document.querySelector("#user-chip");
      if (userChip) userChip.textContent = teacherName;
      await renderTeacher();
    }
  };
  document.querySelector("#change-teacher").addEventListener("click", saveTeacher);
  document.querySelector("#teacher-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTeacher();
    }
  });

  document.querySelectorAll("[data-delete]").forEach((b) => {
    b.addEventListener("click", async () => {
      const hw = await DatabaseService.getHomework();
      const target = hw.find((item) => item.id === b.dataset.delete);
      if (!target || !confirm(t("deleteConfirm", { title: target.title }))) return;
      await DatabaseService.deleteHomework(target.id);
      showToast(t("deletedToast"));
      await renderTeacher();
    });
  });

  document.querySelectorAll("[data-track]").forEach((b) => {
    b.addEventListener("click", () => renderTracker(b.dataset.track));
  });
}

/**
 * Assignment Creator with Inline Microphone Recording
 */
function renderCreator() {
  VoiceSystem.stopAllPlayback();
  app.innerHTML = `
    <section class="page-heading">
      <div>
        <div class="eyebrow">${t("newLabel")}</div>
        <h1>${t("createAssignment")}</h1>
        <p class="subtitle">${t("createSubtitle")}</p>
      </div>
      <button class="button button-ghost" id="cancel-create" type="button">${t("backDashboard")}</button>
    </section>

    <div class="creator-layout">
      <form class="panel" id="assignment-form">
        <div class="panel-header">
          <div>
            <h2>${t("assignmentDetails")}</h2>
            <p class="helper">${t("fieldsSaved")}</p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="title">${t("title")}</label>
            <input id="title" name="title" required placeholder="${t("titlePlaceholder")}" />
          </div>
          <div class="field">
            <label for="subject">${t("subject")}</label>
            <input id="subject" name="subject" required placeholder="${t("subjectPlaceholder")}" />
          </div>
          <div class="field">
            <label for="due-date">${t("dueDate")}</label>
            <input id="due-date" name="dueDate" type="date" required value="${getFutureDate(7)}" />
          </div>
        </div>

        <div id="question-list"></div>

        <div class="creator-actions">
          <button class="button button-secondary" id="add-question" type="button">${t("addQuestion")}</button>
          <button class="button button-primary" type="submit">${t("publish")}</button>
        </div>
      </form>

      <aside class="panel preview-panel">
        <div class="panel-header">
          <div>
            <h2>${t("checklist")}</h2>
            <p class="helper">${t("checklistHelp")}</p>
          </div>
        </div>
        <div class="preview-box">
          <p>${t("checklistText")}</p>
          <ul class="preview-list">
            <li><span>${t("questions")}</span><strong id="preview-count">1</strong></li>
            <li><span>${t("answerChoices")}</span><strong>${t("perQuestion")}</strong></li>
            <li><span>${t("grading")}</span><strong>${t("automatic")}</strong></li>
          </ul>
        </div>
      </aside>
    </div>
  `;

  const container = document.querySelector("#question-list");
  addQuestionBuilder(container);

  document.querySelector("#add-question").addEventListener("click", () => {
    addQuestionBuilder(container);
    document.querySelector("#preview-count").textContent = container.children.length;
  });

  document.querySelector("#cancel-create").addEventListener("click", renderTeacher);
  document.querySelector("#assignment-form").addEventListener("submit", publishAssignment);
}

function addQuestionBuilder(container) {
  const number = container.children.length + 1;
  const wrapper = document.createElement("div");
  wrapper.className = "question-builder";
  wrapper.dataset.audio = "";
  wrapper.dataset.optionsAudio = JSON.stringify([null, null, null, null]);

  wrapper.innerHTML = `
    <div class="question-builder-header">
      <h3><span class="question-number">${number}</span>${t("questionNumber", { n: number })}</h3>
      ${number > 1 ? `<button class="button button-danger button-small remove-q" type="button">${t("remove")}</button>` : ""}
    </div>

    <!-- Main Question Audio Recorder -->
    <div class="audio-recorder-bar">
      <button class="audio-btn record-q-btn" type="button">🎙️ ${t("recordQuestionAudio")}</button>
      <button class="audio-btn stop-q-btn" type="button" style="display:none">⏹️ ${t("stopRecordingState")}</button>
      <span class="audio-pill q-audio-status" style="display:none">✓ ${t("audioRecorded")}</span>
      <button class="audio-btn play-q-btn" type="button" style="display:none">▶️ ${t("playAudio")}</button>
      <button class="audio-btn del-q-btn" type="button" style="display:none">🗑️</button>
    </div>

    <div class="field" style="margin-bottom:14px">
      <label>${t("questionText")}</label>
      <input class="question-text" required placeholder="${t("questionPlaceholder")}" />
    </div>

    <div class="options-grid">
      ${letters[language].map((letter, i) => `
        <div class="option-row" data-index="${i}">
          <input type="radio" name="correct-${number}" value="${i}" ${i === 0 ? "checked" : ""} />
          <span class="option-letter">${letter}</span>
          <input class="option-text" type="text" required placeholder="${t("answerPlaceholder", { letter })}" />
          <button class="audio-btn record-opt-btn" type="button" title="${t("recordOptionAudio")}">🎙️</button>
          <span class="opt-audio-status" style="display:none; font-size:10px">✓</span>
        </div>
      `).join("")}
    </div>
  `;

  container.appendChild(wrapper);

  // Wire Question Audio Recorder
  const recordQBtn = wrapper.querySelector(".record-q-btn");
  const stopQBtn = wrapper.querySelector(".stop-q-btn");
  const playQBtn = wrapper.querySelector(".play-q-btn");
  const delQBtn = wrapper.querySelector(".del-q-btn");
  const statusQ = wrapper.querySelector(".q-audio-status");

  recordQBtn.addEventListener("click", () => {
    recordQBtn.classList.add("recording");
    recordQBtn.style.display = "none";
    stopQBtn.style.display = "inline-flex";

    VoiceSystem.startRecording(
      (dataUrl) => {
        wrapper.dataset.audio = dataUrl;
        stopQBtn.style.display = "none";
        recordQBtn.style.display = "none";
        recordQBtn.classList.remove("recording");
        statusQ.style.display = "inline-flex";
        playQBtn.style.display = "inline-flex";
        delQBtn.style.display = "inline-flex";
      },
      () => {
        stopQBtn.style.display = "none";
        recordQBtn.style.display = "inline-flex";
        recordQBtn.classList.remove("recording");
        alert(t("micPermissionDenied"));
      }
    );
  });

  stopQBtn.addEventListener("click", () => VoiceSystem.stopRecording());

  playQBtn.addEventListener("click", () => {
    VoiceSystem.playOrSpeak(wrapper.dataset.audio, null);
  });

  delQBtn.addEventListener("click", () => {
    wrapper.dataset.audio = "";
    statusQ.style.display = "none";
    playQBtn.style.display = "none";
    delQBtn.style.display = "none";
    recordQBtn.style.display = "inline-flex";
  });

  // Wire Choice Audio Recorders
  wrapper.querySelectorAll(".option-row").forEach((row) => {
    const idx = Number(row.dataset.index);
    const optRecBtn = row.querySelector(".record-opt-btn");
    const optStatus = row.querySelector(".opt-audio-status");

    optRecBtn.addEventListener("click", () => {
      if (optRecBtn.classList.contains("recording")) {
        VoiceSystem.stopRecording();
        optRecBtn.classList.remove("recording");
        optRecBtn.textContent = "🎙️";
      } else {
        VoiceSystem.stopRecording();
        wrapper.querySelectorAll(".record-opt-btn.recording").forEach((button) => {
          button.classList.remove("recording");
          button.textContent = "🎙️";
        });
        optRecBtn.classList.add("recording");
        optRecBtn.textContent = "⏹️️";
        VoiceSystem.startRecording(
          (dataUrl) => {
            const arr = JSON.parse(wrapper.dataset.optionsAudio);
            arr[idx] = dataUrl;
            wrapper.dataset.optionsAudio = JSON.stringify(arr);
            optStatus.style.display = "inline";
            optRecBtn.classList.remove("recording");
            optRecBtn.textContent = "✓";
          },
          () => {
            optRecBtn.classList.remove("recording");
            optRecBtn.textContent = "🎙️";
            alert(t("micPermissionDenied"));
          }
        );
      }
    });
  });

  wrapper.querySelector(".remove-q")?.addEventListener("click", () => {
    wrapper.remove();
    document.querySelectorAll(".question-builder").forEach((b, idx) => {
      const num = idx + 1;
      b.querySelector(".question-number").textContent = num;
      b.querySelector("h3").lastChild.textContent = t("questionNumber", { n: num });
    });
    document.querySelector("#preview-count").textContent = container.children.length;
  });
}

async function publishAssignment(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const builders = [...document.querySelectorAll(".question-builder")];
  const questions = [];

  for (const b of builders) {
    const text = b.querySelector(".question-text").value.trim();
    const options = [...b.querySelectorAll(".option-text")].map((i) => i.value.trim());
    const selected = b.querySelector("input[type='radio']:checked");

    if (!text) return alert(t("questionBlank"));
    if (options.some((opt) => !opt)) return alert(t("optionsMissing"));
    if (!selected) return alert(t("correctMissing"));

    questions.push({
      id: `q-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      text,
      audio: b.dataset.audio || null,
      options,
      optionsAudio: JSON.parse(b.dataset.optionsAudio),
      correctIndex: Number(selected.value)
    });
  }

  const data = new FormData(form);
  const title = data.get("title").trim();
  const subject = data.get("subject").trim();
  const dueDate = data.get("dueDate");

  if (!title || !subject || !dueDate) return alert(t("completeDetails"));

  const newAssignment = {
    id: `hw-${Date.now()}`,
    title,
    subject,
    dueDate,
    teacherName: teacherName || "Teacher",
    classCode: teacherCode,
    createdAt: new Date().toISOString(),
    questions
  };

  await DatabaseService.createHomework(newAssignment);

  showToast(t("publishedToast"));
  renderTeacher();
}

async function renderTracker(homeworkId) {
  const homework = await DatabaseService.getHomework();
  const target = homework.find((h) => h.id === homeworkId);
  const submissions = (await DatabaseService.getSubmissions()).filter((s) => s.homeworkId === homeworkId);

  app.innerHTML = `
    <section class="page-heading">
      <div>
        <div class="eyebrow">${t("resultsWorkspace")}</div>
        <h1>${escapeHtml(target.title)}</h1>
        <p class="subtitle">${escapeHtml(target.subject)} · ${target.questions.length} ${t("questions")} · ${t("dueLabel", { date: formatDate(target.dueDate) })}</p>
      </div>
      <button class="button button-ghost" id="back-tracker" type="button">${t("backDashboard")}</button>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${t("tracker")}</h2>
          <p class="helper">${t("received", { n: submissions.length })}</p>
        </div>
        <span class="badge badge-complete">${t("classAverage", { n: getAverageScore(submissions) })}</span>
      </div>

      <div>
        ${submissions.length ? submissions.map((s) => `
          <div class="tracker-row">
            <div class="student-info">
              <span class="student-avatar">${initials(s.studentName)}</span>
              <div>
                <strong>${escapeHtml(s.studentName)}</strong>
                <small>${t("submittedAt", { date: formatDateTime(s.date) })}</small>
              </div>
            </div>
            <div class="score">
              ${s.score}/${s.total}
              <small>${Math.round((s.score / s.total) * 100)}%</small>
            </div>
            <span class="badge ${s.score / s.total >= 0.7 ? "badge-passed" : "badge-failed"}">
              ${s.score / s.total >= 0.7 ? t("passed") : t("failed")}
            </span>
            <button class="button button-secondary button-small" data-detail="${s.id}" type="button">${t("viewAnswers")}</button>
          </div>
        `).join("") : `<div class="empty-state"><h3>${t("noStudent")}</h3><p>${t("shareAssignment")}</p></div>`}
      </div>
    </section>
  `;

  document.querySelector("#back-tracker").addEventListener("click", renderTeacher);
  document.querySelectorAll("[data-detail]").forEach((b) => {
    b.addEventListener("click", () => {
      const sub = submissions.find((s) => s.id === b.dataset.detail);
      const modal = document.createElement("div");
      modal.className = "modal-backdrop";
      modal.innerHTML = `
        <div class="modal">
          <div class="panel-header">
            <div>
              <div class="eyebrow">${t("studentReview")}</div>
              <h2>${escapeHtml(sub.studentName)} · ${sub.score}/${sub.total}</h2>
            </div>
            <button class="icon-button modal-close" type="button">&times;</button>
          </div>
          <div class="review-list">
            ${target.questions.map((q, idx) => `
              <article class="review-item">
                <h3>${idx + 1}.${escapeHtml(q.text)}</h3>
                <div class="review-answer ${q.correctIndex === sub.answers[idx] ? "correct" : "wrong"}">
                  <strong>${t("student")}:</strong> ${escapeHtml(q.options[sub.answers[idx]] ?? "-")}
                </div>
                <div class="review-answer correct">
                  <strong>${t("correct")}:</strong> ${escapeHtml(q.options[q.correctIndex])}
                </div>
              </article>
            `).join("")}
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector(".modal-close").addEventListener("click", () => modal.remove());
      modal.addEventListener("click", (evt) => { if (evt.target === modal) modal.remove(); });
    });
  });
}

/**
 * Event Listeners & Global Initialization
 */
document.documentElement.lang = language;
document.documentElement.dir = language === "ar" ? "rtl" : "ltr";

document.querySelector("#language-toggle")?.addEventListener("click", () => {
  setLanguage(language === "en" ? "ar" : "en");
});

document.querySelectorAll(".role-button").forEach((btn) => {
  btn.addEventListener("click", () => setRole(btn.dataset.role));
});

window.addEventListener("beforeunload", () => {
  VoiceSystem.stopAllPlayback();
});

initializeDefaultData().finally(() => render());