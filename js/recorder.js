let recorder;
let chunks = [];
let stream;

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");

startBtn.onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    recorder = new MediaRecorder(stream);

    chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download =
        "flow-recording-" + new Date().toISOString().slice(0, 10) + ".webm";
      a.click();

      URL.revokeObjectURL(url);

      chunks = [];
    };

    recorder.start();

    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error("Recording failed:", err);
  }
};

stopBtn.onclick = () => {
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  stopBtn.disabled = true;
};
