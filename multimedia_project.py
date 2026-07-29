"""
Multimedia File Analyzer and Processor Using Python
A beginner-friendly menu-based project for multimedia systems practical lessons.
"""

import os
from collections import Counter

import cv2
import librosa
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf


def text_processing():
    """Load and process text from sample.txt."""
    file_path = "sample.txt"

    if not os.path.exists(file_path):
        print(f"\nError: '{file_path}' not found.")
        return

    # Read text file content
    with open(file_path, "r", encoding="utf-8") as file:
        text = file.read()

    print("\n--- Text Processing ---")

    # Show original preview (first 300 characters for readability)
    preview_length = 300
    print("\nOriginal Text Preview:")
    print(text[:preview_length] + ("..." if len(text) > preview_length else ""))

    # Basic text statistics
    num_characters = len(text)
    words = text.split()
    num_words = len(words)

    print(f"\nNumber of characters: {num_characters}")
    print(f"Number of words: {num_words}")

    # Uppercase and lowercase versions
    uppercase_text = text.upper()
    lowercase_text = text.lower()

    print("\nText in UPPERCASE (preview):")
    print(uppercase_text[:preview_length] + ("..." if len(uppercase_text) > preview_length else ""))

    print("\nText in lowercase (preview):")
    print(lowercase_text[:preview_length] + ("..." if len(lowercase_text) > preview_length else ""))

    # Top 5 most common words (case-insensitive, punctuation stripped simply)
    cleaned_words = [
        word.strip(".,!?;:\"'()[]{}<>").lower()
        for word in words
        if word.strip(".,!?;:\"'()[]{}<>")
    ]
    word_counts = Counter(cleaned_words)
    top_five = word_counts.most_common(5)

    print("\nTop 5 most common words:")
    for word, count in top_five:
        print(f"{word}: {count}")

    # Replace one word with another word
    old_word = input("\nEnter a word to replace: ").strip()
    new_word = input("Enter the new word: ").strip()

    processed_text = text.replace(old_word, new_word)

    # Save processed text
    output_file = "cleaned_text.txt"
    with open(output_file, "w", encoding="utf-8") as file:
        file.write(processed_text)

    print(f"\nProcessed text saved as '{output_file}'.")


def image_processing():
    """Load and process image from image.jpg."""
    file_path = "image.jpg"

    if not os.path.exists(file_path):
        print(f"\nError: '{file_path}' not found.")
        return

    # Load image in BGR format (OpenCV default)
    image = cv2.imread(file_path)

    if image is None:
        print("\nError: Unable to load image. File may be corrupted or unsupported.")
        return

    print("\n--- Image Processing ---")
    print(f"Image type: {type(image)}")
    print(f"Image shape (height, width, channels): {image.shape}")

    # Convert BGR to RGB for correct matplotlib display
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    # Convert to grayscale
    gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Split B, G, R channels (OpenCV stores channels in BGR order)
    b_channel, g_channel, r_channel = cv2.split(image)

    # Resize image to half of original dimensions
    resized_image = cv2.resize(image, (image.shape[1] // 2, image.shape[0] // 2))
    resized_rgb = cv2.cvtColor(resized_image, cv2.COLOR_BGR2RGB)

    # Add Gaussian noise
    noise = np.random.normal(0, 25, image.shape).astype(np.float32)
    noisy_image = np.clip(image.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    noisy_rgb = cv2.cvtColor(noisy_image, cv2.COLOR_BGR2RGB)

    # Apply Gaussian blur
    blurred_image = cv2.GaussianBlur(image, (7, 7), 0)
    blurred_rgb = cv2.cvtColor(blurred_image, cv2.COLOR_BGR2RGB)

    # Save a compressed image (lower JPEG quality means more compression)
    compressed_output = "compressed_image.jpg"
    cv2.imwrite(compressed_output, image, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
    print(f"Compressed image saved as '{compressed_output}'.")

    # Display all requested views
    plt.figure(figsize=(15, 10))

    plt.subplot(3, 3, 1)
    plt.imshow(rgb_image)
    plt.title("Original Image (RGB)")
    plt.axis("off")

    plt.subplot(3, 3, 2)
    plt.imshow(gray_image, cmap="gray")
    plt.title("Grayscale")
    plt.axis("off")

    plt.subplot(3, 3, 3)
    plt.imshow(r_channel, cmap="Reds")
    plt.title("Red Channel")
    plt.axis("off")

    plt.subplot(3, 3, 4)
    plt.imshow(g_channel, cmap="Greens")
    plt.title("Green Channel")
    plt.axis("off")

    plt.subplot(3, 3, 5)
    plt.imshow(b_channel, cmap="Blues")
    plt.title("Blue Channel")
    plt.axis("off")

    plt.subplot(3, 3, 6)
    plt.imshow(resized_rgb)
    plt.title("Resized Image")
    plt.axis("off")

    plt.subplot(3, 3, 7)
    plt.imshow(noisy_rgb)
    plt.title("Noisy Image")
    plt.axis("off")

    plt.subplot(3, 3, 8)
    plt.imshow(blurred_rgb)
    plt.title("Blurred Image")
    plt.axis("off")

    plt.tight_layout()
    plt.show()


def audio_processing():
    """Load and process audio from audio.wav."""
    file_path = "audio.wav"

    if not os.path.exists(file_path):
        print(f"\nError: '{file_path}' not found.")
        return

    print("\n--- Audio Processing ---")

    # Load audio preserving original sampling rate
    audio, sr = librosa.load(file_path, sr=None)

    # Basic audio information
    duration = len(audio) / sr
    print(f"Audio shape: {audio.shape}")
    print(f"Sampling rate: {sr} Hz")
    print(f"Duration: {duration:.2f} seconds")

    # Time axis for plotting
    time_axis = np.linspace(0, duration, num=len(audio))

    # Add Gaussian noise to audio
    noise = np.random.normal(0, 0.02, len(audio))
    noisy_audio = audio + noise

    # Low-pass filter using FFT
    fft_audio = np.fft.rfft(noisy_audio)
    frequencies = np.fft.rfftfreq(len(noisy_audio), d=1 / sr)

    cutoff_frequency = 4000  # 4 kHz cutoff
    fft_filtered = fft_audio.copy()
    fft_filtered[frequencies > cutoff_frequency] = 0

    filtered_audio = np.fft.irfft(fft_filtered, n=len(noisy_audio))

    # Calculate SNR (Signal-to-Noise Ratio)
    signal_power = np.mean(audio**2)
    noise_power = np.mean((audio - noisy_audio) ** 2)
    snr_db = 10 * np.log10(signal_power / (noise_power + 1e-12))
    print(f"SNR (original vs noisy): {snr_db:.2f} dB")

    # Save processed audio
    output_file = "processed_audio.wav"
    sf.write(output_file, filtered_audio, sr)
    print(f"Processed audio saved as '{output_file}'.")

    # Plot original and noisy waveform
    plt.figure(figsize=(12, 6))

    plt.subplot(2, 1, 1)
    plt.plot(time_axis, audio, color="blue")
    plt.title("Original Audio Waveform")
    plt.xlabel("Time (s)")
    plt.ylabel("Amplitude")

    plt.subplot(2, 1, 2)
    plt.plot(time_axis, noisy_audio, color="orange")
    plt.title("Noisy Audio Waveform")
    plt.xlabel("Time (s)")
    plt.ylabel("Amplitude")

    plt.tight_layout()
    plt.show()


def video_processing():
    """Load a video and display basic information from video.mp4."""
    file_path = "video.mp4"

    if not os.path.exists(file_path):
        print(f"\nError: '{file_path}' not found.")
        return

    print("\n--- Video Information ---")

    # Open video file
    cap = cv2.VideoCapture(file_path)

    if not cap.isOpened():
        print("Error: Unable to open video file.")
        return

    # Read first frame
    ret, first_frame = cap.read()
    if not ret:
        print("Error: Unable to read the first frame.")
        cap.release()
        return

    # Gather video properties
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = total_frames / fps if fps > 0 else 0

    print(f"First frame shape: {first_frame.shape}")
    print(f"Total number of frames: {total_frames}")
    print(f"FPS: {fps:.2f}")
    print(f"Video duration: {duration:.2f} seconds")

    # Convert first frame to RGB for plotting
    first_frame_rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)

    plt.figure(figsize=(8, 5))
    plt.imshow(first_frame_rgb)
    plt.title("First Video Frame")
    plt.axis("off")
    plt.show()

    cap.release()


def main_menu():
    """Display menu and route user to selected multimedia processing section."""
    while True:
        print("\n===== Multimedia File Analyzer and Processor =====")
        print("1. Text Processing")
        print("2. Image Processing")
        print("3. Audio Processing")
        print("4. Video Information")
        print("5. Exit")

        choice = input("Enter your choice (1-5): ").strip()

        if choice == "1":
            text_processing()
        elif choice == "2":
            image_processing()
        elif choice == "3":
            audio_processing()
        elif choice == "4":
            video_processing()
        elif choice == "5":
            print("Exiting program. Goodbye!")
            break
        else:
            print("Invalid choice. Please enter a number from 1 to 5.")


# Program entry point
if __name__ == "__main__":
    main_menu()
