// Camera module - handles all camera-related functionality
class CameraController {
  constructor() {
    this.video = document.getElementById("video");
    this.preview = document.getElementById("preview");
    this.startCameraBtn = document.getElementById("start-camera");
    this.captureBtn = document.getElementById("capture");
    this.retakeBtn = document.getElementById("retake");
    
    this.stream = null;
    this.capturedBlob = null;
    
    // Detect iOS
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    this.initEventListeners();
  }

  initEventListeners() {
    this.startCameraBtn.addEventListener("click", () => this.startCamera());
    this.captureBtn.addEventListener("click", () => this.capturePhoto());
    this.retakeBtn.addEventListener("click", () => this.retakePhoto());
  }

  async startCamera() {
    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera access is not supported on this browser or requires HTTPS. Please use HTTPS or try a different browser.");
      console.error("getUserMedia not supported. Current protocol:", window.location.protocol);
      return;
    }

    try {
      // iOS-specific constraints
      const constraints = {
        video: {
          facingMode: "environment", // Prefer back camera on mobile
          width: { ideal: this.isIOS ? 1280 : 1920 },
          height: { ideal: this.isIOS ? 720 : 1080 }
        },
        audio: false
      };
      
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      this.video.srcObject = this.stream;
      
      // iOS requires explicit play() call
      if (this.isIOS) {
        this.video.setAttribute('playsinline', 'true');
        this.video.setAttribute('muted', 'true');
      }
      
      // Wait for video to be ready before showing
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(() => {
            console.log("Video playing");
            resolve();
          }).catch(err => {
            console.error("Play error:", err);
            // iOS sometimes needs a second attempt
            setTimeout(() => {
              this.video.play().then(resolve).catch(resolve);
            }, 100);
          });
        };
      });
      
      this.video.classList.remove("hidden");
      this.preview.classList.add("hidden");
      this.startCameraBtn.classList.add("hidden");
      this.captureBtn.classList.remove("hidden");
      this.retakeBtn.classList.add("hidden");
      
      console.log("Camera started successfully");
    } catch (err) {
      console.error("Camera error:", err);
      let errorMessage = "Could not access camera: " + err.message;
      
      // Provide helpful iOS-specific error messages
      if (this.isIOS && err.name === 'NotAllowedError') {
        errorMessage = "Camera access denied. Please go to Settings > Safari > Camera and allow access.";
      } else if (err.name === 'NotFoundError') {
        errorMessage = "No camera found on this device.";
      } else if (err.name === 'NotReadableError') {
        errorMessage = "Camera is already in use by another application.";
      }
      
      alert(errorMessage);
    }
  }

  capturePhoto() {
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.video, 0, 0);
    
    // iOS Safari supports webp better, but JPEG is more universal
    const imageFormat = this.isIOS ? "image/jpeg" : "image/jpeg";
    const quality = 0.92;
    
    canvas.toBlob((blob) => {
      if (!blob) {
        console.error("Failed to create blob");
        alert("Failed to capture photo. Please try again.");
        return;
      }
      
      this.capturedBlob = blob;
      const imageUrl = URL.createObjectURL(blob);
      this.preview.src = imageUrl;
      
      // Stop and hide video, show preview
      this.stopCamera();
      this.video.classList.add("hidden");
      this.preview.classList.remove("hidden");
      
      this.captureBtn.classList.add("hidden");
      this.retakeBtn.classList.remove("hidden");
      
      // Dispatch custom event that analyzer can listen to
      window.dispatchEvent(new CustomEvent('photoCapture', { 
        detail: { message: "Photo captured! Click 'Analyze Food' to process." }
      }));
      
      console.log("Photo captured:", blob.size, "bytes");
    }, imageFormat, quality);
  }

  async retakePhoto() {
    try {
      this.capturedBlob = null;
      await this.startCamera();
      
      this.retakeBtn.classList.add("hidden");
      this.captureBtn.classList.remove("hidden");
      
      // Clear any previous messages
      window.dispatchEvent(new CustomEvent('photoRetake'));
      
      console.log("Ready to capture again");
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera: " + err.message);
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.video.pause();
    this.video.srcObject = null;
    console.log("Camera stopped");
  }

  getCapturedBlob() {
    return this.capturedBlob;
  }

  reset() {
    this.capturedBlob = null;
    this.stopCamera();
    this.video.classList.add("hidden");
    this.preview.classList.add("hidden");
    this.startCameraBtn.classList.remove("hidden");
    this.captureBtn.classList.add("hidden");
    this.retakeBtn.classList.add("hidden");
  }
}

// Initialize camera controller when DOM is ready
const camera = new CameraController();
