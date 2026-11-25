import tensorflow as tf
from tensorflow.keras import layers, models

def build_stacked_bilstm(input_shape, num_classes=3, learning_rate=1e-3):
    input_layer = layers.Input(shape=input_shape, name="window_input")
    x = layers.Bidirectional(layers.LSTM(64, return_sequences=True), name="bilstm_1")(input_layer)
    x = layers.Dropout(0.3, name="dropout_1")(x)
    x = layers.Bidirectional(layers.LSTM(32), name="bilstm_2")(x)
    x = layers.Dropout(0.3, name="dropout_2")(x)
    x = layers.Dense(32, activation="relu", name="dense_1")(x)
    output_layer = layers.Dense(num_classes, activation="softmax", name="output")(x)
    
    model = models.Model(inputs=input_layer, outputs=output_layer, name="Stacked_BiLSTM")
    optimizer = tf.keras.optimizers.Adam(learning_rate=learning_rate)
    model.compile(
        optimizer=optimizer,
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model
